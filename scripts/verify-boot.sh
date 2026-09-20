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
export LOG_LEVEL=${LOG_LEVEL:-info}

# each service gets its own process group so cleanup also reaps children (next-server, temporal core)
spawn() { setsid "$@" & PIDS+=($!); LAST_PID=$!; }
step() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
wait_http() { # url attempts
  for _ in $(seq 1 "$2"); do curl -fsS "$1" >/dev/null 2>&1 && return 0; sleep 1; done
  echo "timeout waiting for $1"; return 1
}

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

step "start worker"
spawn node apps/worker/dist/main.js >"$LOGS/worker.log" 2>&1
WORKER_PID=$LAST_PID
for _ in $(seq 1 60); do grep -q "steward worker ready" "$LOGS/worker.log" 2>/dev/null && break; kill -0 $WORKER_PID 2>/dev/null || { echo "worker exited"; cat "$LOGS/worker.log"; exit 1; }; sleep 1; done
grep -q "steward worker ready" "$LOGS/worker.log" || { echo "worker did not report ready"; tail -50 "$LOGS/worker.log"; exit 1; }

step "worker crash recovery (SIGKILL → restart)"
kill -9 -- "-$WORKER_PID"; sleep 1
spawn node apps/worker/dist/main.js >"$LOGS/worker2.log" 2>&1
for _ in $(seq 1 60); do grep -q "steward worker ready" "$LOGS/worker2.log" 2>/dev/null && break; sleep 1; done
grep -q "steward worker ready" "$LOGS/worker2.log" || { echo "restarted worker did not report ready"; tail -50 "$LOGS/worker2.log"; exit 1; }

step "start web (standalone build)"
# same layout as infra/docker/web.Dockerfile: static assets live next to the standalone server
rm -rf apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
PORT=$WEB_PORT HOSTNAME=127.0.0.1 spawn node apps/web/.next/standalone/apps/web/server.js >"$LOGS/web.log" 2>&1
wait_http "$APP_URL/" 60
[ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/app")" = "307" ] || { echo "expected /app to redirect when logged out"; exit 1; }

step "auth + tenant smoke (register → org → company → task)"
CK=$(mktemp)
J=(-H content-type:application/json -H x-steward-csrf:1 -sS -b "$CK" -c "$CK")
EMAIL="boot-$(date +%s)@example.com"
ORG=$(curl "${J[@]}" -X POST "$API_URL/v1/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\",\"name\":\"Boot\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["organization"]["id"])')
CO=$(curl "${J[@]}" -X POST "$API_URL/v1/orgs/$ORG/companies" -d '{"name":"Boot Co","autonomyLevel":1,"profile":{"description":"boot validation","stage":"idea"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["company"]["id"])')
curl "${J[@]}" -X POST "$API_URL/v1/companies/$CO/tasks" -d '{"title":"Boot task","priority":"medium"}' | python3 -c 'import sys,json;t=json.load(sys.stdin)["task"];print("task:",t["id"],t["status"])'
curl "${J[@]}" "$API_URL/v1/companies/$CO" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["agents"], "no seeded agents";print("agents:",[a["kind"] for a in d["agents"]])'
# through the web proxy the session cookie must be first-party as well
curl -sS -b "$CK" "$APP_URL/api/v1/auth/me" | python3 -c 'import sys,json;d=json.load(sys.stdin);assert d["user"]["email"], d;print("web proxy /api/v1 ok")'
rm -f "$CK"

step "playwright golden path"
E2E_BASE_URL=$APP_URL pnpm --filter @steward/web exec playwright test

step "OK — boot validation passed (logs in $LOGS)"
