#!/usr/bin/env bash
# End-to-end smoke test against a running server.
#   npm run build && LINDA_DB_PATH=.data/e2e.db npx next start -p 3111 &
#   scripts/e2e.sh http://localhost:3111
set -euo pipefail

BASE="${1:-http://localhost:3111}"
JAR="$(mktemp)"
EMAIL="founder-$$@example.com"
PASS="correct-horse-battery"
fail() { echo "FAIL: $*" >&2; exit 1; }
step() { printf '\n=== %s\n' "$*"; }

req() { # method path [json]
  curl -sS -b "$JAR" -c "$JAR" -X "$1" -H 'Content-Type: application/json' \
    ${3:+-d "$3"} "$BASE/api$2"
}
code() {
  curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" -X "$1" \
    -H 'Content-Type: application/json' ${3:+-d "$3"} "$BASE/api$2"
}
jq_get() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1],{'d':d}))" "$1"; }

step 'anonymous access is rejected'
[ "$(code GET /workspaces/00000000-0000-0000-0000-000000000000)" = 401 ] \
  || fail 'unauthenticated request was not 401'

step 'catalog is public'
AGENTS=$(req GET /catalog | jq_get "len(d['agents'])")
[ "$AGENTS" = 8 ] || fail "expected 8 agents, got $AGENTS"

step 'signup'
WS=$(req POST /auth/signup "{\"email\":\"$EMAIL\",\"name\":\"Ada Lovelace\",\"password\":\"$PASS\",\"workspaceName\":\"Acme\"}" \
  | jq_get "d['workspace']['id']")
[ -n "$WS" ] || fail 'no workspace returned'
echo "workspace=$WS"

step 'duplicate signup is rejected'
[ "$(code POST /auth/signup "{\"email\":\"$EMAIL\",\"name\":\"X\",\"password\":\"$PASS\"}")" = 409 ] \
  || fail 'duplicate email was not 409'

step 'weak password is rejected'
[ "$(code POST /auth/signup '{"email":"weak@example.com","name":"X","password":"short"}')" = 422 ] \
  || fail 'weak password was not 422'

step 'onboarding: profile'
req POST "/workspaces/$WS/onboarding/profile" \
  '{"legalName":"Acme SAS","industry":"software","size":"2-10","website":"https://acme.example","description":"We make things","tone":"friendly","timezone":"Europe/Paris"}' > /dev/null
S=$(req GET "/workspaces/$WS/onboarding" | jq_get "d['step']")
[ "$S" = pick_goals ] || fail "expected pick_goals, got $S"

step 'onboarding: goals + recommendation'
REC=$(req POST "/workspaces/$WS/onboarding/goals" '{"goals":["capture_leads","grow_audience"]}' \
  | jq_get "','.join(a['key'] for a in d['recommended'])")
echo "recommended=$REC"
case "$REC" in assistant*) ;; *) fail "Charly should lead the recommendation, got $REC" ;; esac

step 'onboarding: hire agents'
req POST "/workspaces/$WS/onboarding/agents" \
  '{"agents":[{"key":"assistant","config":{}},{"key":"phone","config":{}},{"key":"marketing","config":{}}]}' > /dev/null
WF_COUNT=$(req GET "/workspaces/$WS/workflows" | jq_get "len(d['workflows'])")
[ "$WF_COUNT" = 7 ] || fail "expected 7 workflows, got $WF_COUNT"

step 'onboarding: re-hiring is idempotent'
req POST "/workspaces/$WS/onboarding/agents" '{"agents":[{"key":"phone","config":{}}]}' > /dev/null
AFTER=$(req GET "/workspaces/$WS/workflows" | jq_get "len(d['workflows'])")
[ "$AFTER" = "$WF_COUNT" ] || fail "re-hire duplicated workflows: $WF_COUNT -> $AFTER"

step 'onboarding: invalid agent config is rejected'
[ "$(code POST "/workspaces/$WS/onboarding/agents" '{"agents":[{"key":"marketing","config":{"postsPerWeek":999}}]}')" = 422 ] \
  || fail 'bad agent config was not 422'

step 'onboarding: connect a tool'
req POST "/workspaces/$WS/onboarding/connections" '{"connections":[{"provider":"calendar"}]}' > /dev/null

step 'onboarding: activate'
FIRST=$(req POST "/workspaces/$WS/onboarding/complete" '{}' | jq_get "d['firstRun']['status']")
[ "$FIRST" = succeeded ] || fail "first run status was $FIRST"
DONE=$(req GET "/workspaces/$WS/onboarding" | jq_get "d['isComplete']")
[ "$DONE" = True ] || fail 'workspace did not reach done'

step 'run a workflow manually with input'
WFID=$(req GET "/workspaces/$WS/workflows" \
  | jq_get "[w['id'] for w in d['workflows'] if w['definitionKey']=='inbound_enquiry'][0]")
OUT=$(req POST "/workspaces/$WS/workflows/$WFID/run" \
  '{"input":{"channel":"web","contact":{"handle":"lead@example.com"},"message":"Can I book a demo urgently?"}}')
RS=$(echo "$OUT" | jq_get "d['run']['status']")
[ "$RS" = succeeded ] || fail "manual run status was $RS"
BOOK=$(echo "$OUT" | jq_get "[s['status'] for s in d['steps'] if s['stepKey']=='book'][0]")
[ "$BOOK" = succeeded ] || fail "calendar step should have run, got $BOOK"

step 'invalid workflow input fails the run, not the request'
BADRUN=$(req POST "/workspaces/$WS/workflows/$WFID/run" '{"input":{"channel":"carrier-pigeon"}}' | jq_get "d['run']['status']")
[ "$BADRUN" = failed ] || fail "expected failed run, got $BADRUN"

step 'pause a workflow, then refuse to run it'
req PATCH "/workspaces/$WS/workflows/$WFID" '{"status":"paused"}' > /dev/null
[ "$(code POST "/workspaces/$WS/workflows/$WFID/run" '{}')" = 409 ] || fail 'paused workflow ran anyway'
req PATCH "/workspaces/$WS/workflows/$WFID" '{"status":"active"}' > /dev/null

step 'activity feed records the journey'
KINDS=$(req GET "/workspaces/$WS/activity" | jq_get "','.join(e['kind'] for e in d['events'])")
for k in workspace.created agent.hired onboarding.completed run.succeeded; do
  case "$KINDS" in *"$k"*) ;; *) fail "activity missing $k" ;; esac
done

step 'tenant isolation'
OTHER_JAR="$(mktemp)"
curl -sS -c "$OTHER_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"email\":\"intruder-$$@example.com\",\"name\":\"Eve\",\"password\":\"$PASS\"}" \
  "$BASE/api/auth/signup" > /dev/null
ISO=$(curl -sS -o /dev/null -w '%{http_code}' -b "$OTHER_JAR" "$BASE/api/workspaces/$WS")
[ "$ISO" = 404 ] || fail "cross-tenant read returned $ISO, expected 404"
ISO2=$(curl -sS -o /dev/null -w '%{http_code}' -b "$OTHER_JAR" -X POST \
  -H 'Content-Type: application/json' -d '{}' "$BASE/api/workspaces/$WS/workflows/$WFID/run")
[ "$ISO2" = 404 ] || fail "cross-tenant run returned $ISO2, expected 404"

step 'logout invalidates the session'
req POST /auth/logout '{}' > /dev/null
[ "$(code GET "/workspaces/$WS")" = 401 ] || fail 'session survived logout'

step 'login resumes the workspace'
LOGIN=$(req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq_get "d['workspaces'][0]['onboardingStep']")
[ "$LOGIN" = done ] || fail "expected done, got $LOGIN"

step 'wrong password is rejected'
[ "$(code POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password-x\"}")" = 401 ] \
  || fail 'wrong password was not 401'

rm -f "$JAR" "$OTHER_JAR"
printf '\n\nALL END-TO-END CHECKS PASSED\n'
