#!/usr/bin/env bash
# End-to-end smoke against a running API + worker: register → company → provider → chat run → poll.
# Usage: API=http://localhost:4000 PROVIDER=openai PROVIDER_KEY=$OPENAI_API_KEY scripts/smoke.sh
set -euo pipefail
API=${API:-http://localhost:4000}
PROVIDER=${PROVIDER:-openai}
PROVIDER_KEY=${PROVIDER_KEY:?set PROVIDER_KEY}
EMAIL="smoke-$(date +%s)@example.com"
J='-H content-type:application/json -H x-steward-csrf:1'

req() { curl -sS -b /tmp/steward.cookies -c /tmp/steward.cookies $J "$@"; }
rm -f /tmp/steward.cookies

echo "== register"
REG=$(req -X POST "$API/v1/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery\",\"name\":\"Smoke\"}")
ORG=$(echo "$REG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["organization"]["id"])')
echo "org=$ORG"

echo "== provider"
req -X POST "$API/v1/orgs/$ORG/providers" -d "{\"providerType\":\"$PROVIDER\",\"secret\":\"$PROVIDER_KEY\"}" | python3 -c 'import sys,json;p=json.load(sys.stdin)["provider"];print(p["id"],p["providerType"],p.get("secretHint"))'
PID=$(req "$API/v1/orgs/$ORG/providers" | python3 -c 'import sys,json;print(json.load(sys.stdin)["providers"][0]["id"])')
echo "-- test credential"; req -X POST "$API/v1/orgs/$ORG/providers/$PID/test" | head -c 300; echo

echo "== company"
CO=$(req -X POST "$API/v1/orgs/$ORG/companies" -d '{"name":"Smoke Labs","autonomyLevel":2,"profile":{"description":"A tiny SaaS that sells a CLI for tidying CSV files.","stage":"idea"}}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["company"]["id"])')
echo "company=$CO"
req "$API/v1/companies/$CO" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("agents:",[a["kind"] for a in d["agents"]]);print("budgets:",[(b["category"],b["limitUsd"]) for b in d["budgets"]])'

echo "== chat run"
CONV=$(req -X POST "$API/v1/companies/$CO/conversations" -d '{}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["conversation"]["id"])')
RUN=$(req -X POST "$API/v1/companies/$CO/conversations/$CONV/messages" -d '{"content":"Write a 3-bullet positioning statement for our CSV tidying CLI, save it as a document titled Positioning, and record a decision about our target customer. Then reply with a one-line summary."}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["run"]["id"])')
echo "run=$RUN"

for i in $(seq 1 60); do
  sleep 5
  ST=$(req "$API/v1/companies/$CO/runs/$RUN" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d["run"];print(r["status"], "iter=",r.get("iterations"), "steps=",len(d["steps"]), "tools=",[t["toolName"]+":"+t["status"] for t in d["toolCalls"]], "wf=",d["workflow"])')
  echo "[$i] $ST"
  case "$ST" in succeeded*|failed*|needs_review*|cancelled*) break;; esac
done

echo "== result"
req "$API/v1/companies/$CO/runs/$RUN" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d["run"];print(json.dumps({"status":r["status"],"error":r.get("error"),"result":r.get("result")},indent=1)[:2500])'
echo "== messages"; req "$API/v1/companies/$CO/conversations/$CONV" | python3 -c 'import sys,json;[print(m["role"],":",m["content"][:300]) for m in json.load(sys.stdin)["messages"]]'
echo "== documents"; req "$API/v1/companies/$CO/documents" | python3 -c 'import sys,json;[print(d["title"],d["folder"]) for d in json.load(sys.stdin)["documents"]]'
echo "== decisions"; req "$API/v1/companies/$CO/decisions" | python3 -c 'import sys,json;[print("-",d["title"]) for d in json.load(sys.stdin)["decisions"]]'
echo "== usage"; req "$API/v1/orgs/$ORG/providers/usage?companyId=$CO" | head -c 600; echo
echo "== events"; req "$API/v1/companies/$CO/events?limit=30" | python3 -c 'import sys,json;[print(e["seq"],e["type"]) for e in json.load(sys.stdin)["events"]]'
