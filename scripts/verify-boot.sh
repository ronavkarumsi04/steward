#!/usr/bin/env bash
# Boot validation: clean install → build → migrate → start API/worker/web from production builds →
# health + auth smoke → Playwright golden path. Requires Docker (Postgres/Redis/Temporal via compose).
# Usage: pnpm verify:boot            (set KEEP=1 to leave services running, SKIP_INSTALL=1 to reuse node_modules)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
LOGS=${LOGS:-$ROOT/data/verify-boot}
mkdir -p "$LOGS"
PIDS=()
cleanup() {
  if [ "${KEEP:-0}" != "1" ]; then
    for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -- "-$p" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT

export NODE_ENV=production
export DATABASE_URL=${DATABASE_URL:-postgres://steward:steward@localhost:5432/steward}
export REDIS_URL=${REDIS_URL:-redis://localhost:6379}
export TEMPORAL_ADDRESS=${TEMPORAL_ADDRESS:-localhost:7233}
export TEMPORAL_TASK_QUEUE="steward-boot-$$"
export WORKER_HEALTH_HOST=127.0.0.1
export WORKER_HEALTH_PORT=${WORKER_HEALTH_PORT:-4340}
export STEWARD_MASTER_KEY=${STEWARD_MASTER_KEY:-$(openssl rand -hex 32)}
export SESSION_SECRET=${SESSION_SECRET:-$(openssl rand -hex 32)}
export API_PORT=${API_PORT:-4100}
export WEB_PORT=${WEB_PORT:-3100}
export API_URL=http://localhost:$API_PORT
export API_INTERNAL_URL=$API_URL
export APP_URL=http://localhost:$WEB_PORT
export NEXT_PUBLIC_API_URL=$API_URL
export ARTIFACT_DIR=$LOGS/artifacts
export ALLOW_SIGNUP=true
export EMBEDDED_API=${EMBEDDED_API:-true}
export LOG_LEVEL=${LOG_LEVEL:-info}

# each service gets its own process group so cleanup also reaps children (next-server, temporal core)
spawn() { setsid "$@" & PIDS+=($!); LAST_PID=$!; }
step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
wait_http() { # url attempts
  for _ in $(seq 1 "$2"); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timeout waiting for $1"; return 1
}

# A smoke call must fail loudly. Parsing an error body with python yields a bare KeyError that hides what
# the API actually said, which is how this step spent a CI run looking like a missing response field.
api() { # METHOD path [json-body] -> prints the response body, exits non-zero on an error status
  local method=$1 path=$2 body=${3:-} out status
  if [ -n "$body" ]; then
    out=$(curl "${J[@]}" -w '\n%{http_code}' -X "$method" "$API_URL$path" -d "$body")
  else
    out=$(curl "${J[@]}" -w '\n%{http_code}' -X "$method" "$API_URL$path")
  fi
  status=$(printf '%s' "$out" | tail -n1)
  out=$(printf '%s' "$out" | sed '$d')
  case "$status" in
    2*) printf '%s' "$out" ;;
    *) echo "FAIL $method $path -> HTTP $status"; echo "$out"; exit 1 ;;
  esac
}
jqn() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

step "infra (docker compose: postgres, redis, temporal)"
docker compose up -d postgres redis temporal
for _ in $(seq 1 60); do
  docker compose ps --format json 2>/dev/null | grep -q '"Health":"unhealthy"' && { echo "unhealthy service"; docker compose ps; exit 1; }
  HEALTHY=$(docker compose ps --format json postgres temporal 2>/dev/null | grep -c '"Health":"healthy"' || true)
  [ "$HEALTHY" -ge 2 ] && break
  sleep 2
done

if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  step "clean install"
  pnpm install --frozen-lockfile
fi

step "build (all packages, production)"
pnpm turbo run build

step "migrate"
pnpm --filter @steward/db migrate

step "start api"
RUN_MIGRATIONS_ON_START=false PORT=$API_PORT spawn node apps/api/dist/main.js >"$LOGS/api.log" 2>&1
wait_http "$API_URL/health" 60
curl -fsS "$API_URL/health"; echo
curl -fsS "$API_URL/health" | grep -q '"db":"ok"' || { echo "api db check failed"; exit 1; }
curl -fsS "$API_URL/health" | grep -q '"temporal":"connected"' || { echo "api temporal check failed"; exit 1; }
# A freshly named queue has no workers. Serving HTTP must not imply that agents can execute.
[ "$(curl -s -o "$LOGS/ready-before-worker.json" -w '%{http_code}' "$API_URL/ready")" = "503" ] || { echo "execution readiness passed without a worker"; exit 1; }

step "start worker"
spawn node apps/worker/dist/main.js >"$LOGS/worker.log" 2>&1
WORKER_PID=$LAST_PID
for _ in $(seq 1 60); do grep -q "steward worker ready" "$LOGS/worker.log" 2>/dev/null && break; kill -0 $WORKER_PID 2>/dev/null || { echo "worker exited"; cat "$LOGS/worker.log"; exit 1; }; sleep 1; done
grep -q "steward worker ready" "$LOGS/worker.log" || { echo "worker did not report ready"; tail -50 "$LOGS/worker.log"; exit 1; }
wait_http "http://127.0.0.1:$WORKER_HEALTH_PORT/ready" 60
curl -fsS "http://127.0.0.1:$WORKER_HEALTH_PORT/ready" | grep -q '"state":"RUNNING"' || { echo "worker process is not ready"; exit 1; }
wait_http "$API_URL/ready" 60
curl -fsS "$API_URL/ready" | grep -q '"executions":"ready"' || { echo "worker queues are not ready"; exit 1; }

step "worker crash recovery (SIGKILL → restart)"
kill -9 -- "-$WORKER_PID"; sleep 1
spawn node apps/worker/dist/main.js >"$LOGS/worker2.log" 2>&1
for _ in $(seq 1 60); do grep -q "steward worker ready" "$LOGS/worker2.log" 2>/dev/null && break; sleep 1; done
grep -q "steward worker ready" "$LOGS/worker2.log" || { echo "restarted worker did not report ready"; tail -50 "$LOGS/worker2.log"; exit 1; }
wait_http "http://127.0.0.1:$WORKER_HEALTH_PORT/ready" 60
wait_http "$API_URL/ready" 60

step "start web (standalone build)"
# same layout as infra/docker/web.Dockerfile: static assets live next to the standalone server
rm -rf apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
rm -rf apps/web/.next/standalone/apps/web/public
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
if [ "$EMBEDDED_API" = "true" ]; then
  # Hosted SSR must work without an HTTP API process at its configured loopback address.
  API_INTERNAL_URL=http://127.0.0.1:1 API_URL=http://127.0.0.1:1 PORT=$WEB_PORT HOSTNAME=127.0.0.1 spawn node apps/web/.next/standalone/apps/web/server.js >"$LOGS/web.log" 2>&1
else
  PORT=$WEB_PORT HOSTNAME=127.0.0.1 spawn node apps/web/.next/standalone/apps/web/server.js >"$LOGS/web.log" 2>&1
fi
wait_http "$APP_URL/" 60
[ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/app")" = "307" ] || { echo "expected /app to redirect when logged out"; exit 1; }

step "auth + tenant smoke (register → org → company → task)"
CK=$(mktemp)
J=(-H content-type:application/json -H x-steward-csrf:1 -sS -b "$CK" -c "$CK")
EMAIL="boot-$(date +%s)@example.com"
# Registration is clickwrap-gated: it must record acceptance of the current contract documents. Ask the API
# which versions are current instead of hard-coding them here, so revising a document cannot silently turn
# this smoke test into a false failure (or, worse, hide a real one).
ACCEPTED=$(api GET /v1/legal/documents | jqn 'json.dumps([{"document":d["document"],"version":d["version"]} for d in d["requiredAgreements"]])')
[ -n "$ACCEPTED" ] || { echo "API reported no required agreements"; exit 1; }
ORG=$(api POST /v1/auth/register "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\",\"name\":\"Boot\",\"accepted\":$ACCEPTED}" | jqn 'd["organization"]["id"]')
[ -n "$ORG" ] || { echo "register returned no organization"; exit 1; }
CO=$(api POST "/v1/orgs/$ORG/companies" '{"name":"Boot Co","autonomyLevel":1,"profile":{"description":"boot validation","stage":"idea"}}' | jqn 'd["company"]["id"]')
[ -n "$CO" ] || { echo "company creation returned no company"; exit 1; }
TASK=$(api POST "/v1/companies/$CO/tasks" '{"title":"Boot task","priority":"medium"}' | jqn 'd["task"]["id"] + " " + d["task"]["status"]')
echo "task: $TASK"
AGENTS=$(api GET "/v1/companies/$CO" | jqn '", ".join(a["kind"] for a in d["agents"])')
[ -n "$AGENTS" ] || { echo "no seeded agents"; exit 1; }
echo "agents: $AGENTS"
# through the web proxy the session cookie must be first-party as well
ME=$(curl -sS -b "$CK" "$APP_URL/api/v1/auth/me" | jqn 'str(d["user"]["email"])')
[ -n "$ME" ] || { echo "web proxy /api/v1/auth/me returned no user"; exit 1; }
echo "web proxy /api/v1 ok as $ME"
rm -f "$CK"

step "playwright golden path"
E2E_BASE_URL=$APP_URL pnpm --filter @steward/web exec playwright test

step "OK — boot validation passed (logs in $LOGS)"
