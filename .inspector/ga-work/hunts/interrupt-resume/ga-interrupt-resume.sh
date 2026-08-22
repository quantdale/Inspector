#!/usr/bin/env bash
# GA Phase 16: interrupt/resume field soak against the INSTALLED artifact.
# Kills `inspector hunt` (fake adapter) at varied lifecycle timings, then
# resumes and checks the invariants:
#   - resume succeeds (exit 0) or fails HONESTLY (documented reason)
#   - no UNIQUE constraint errors anywhere in stderr/stdout
#   - no sequence reuse: step ids/sequences strictly increase after resume
#   - runs.db is readable and unlocked after kill + cleanup
set -u
INS="/c/Users/Michael Roy/AppData/Roaming/npm/inspector"
ROOT="$TEMP/ga-field/ws"
RESULTS="$TEMP/ga-field/logs/interrupt-resume-results.jsonl"
: >"$RESULTS"

run_one() {
  local label="$1" delay_ms="$2"
  local ws
  ws=$(mktemp -d "$ROOT/ir-XXXXXX")
  # start hunt in background; fake adapter, small budget for speed
  "$INS" hunt --adapter web --url http://127.0.0.1:8123/ --workspace "$ws" --max-actions 80 --max-minutes 5 --seed 5 \
    >"$ws/hunt.log" 2>&1 &
  local pid=$!
  sleep "$(awk "BEGIN{print $delay_ms/1000}")"
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null

  local killed_steps=""
  if [ -f "$ws/.inspector/runs.db" ]; then
    killed_steps=$(node -e "
      const Database = require('C:/Users/Michael Roy/AppData/Roaming/npm/node_modules/inspector-cli/node_modules/better-sqlite3');
      try {
        const db = new Database(process.argv[1], { readonly: true });
        const r = db.prepare('SELECT COUNT(*) c FROM steps').get();
        const run = db.prepare('SELECT id, status FROM runs').get();
        console.log(JSON.stringify({ steps: r.c, status: run ? run.status : null, id: run ? run.id : null }));
      } catch (e) { console.log(JSON.stringify({ dbError: String(e).slice(0,120) })); }
    " "$ws/.inspector/runs.db" 2>&1)
  else
    killed_steps='{"steps":0,"status":null,"id":null}'
  fi

  local rid
  rid=$(echo "$killed_steps" | python -c "import sys,json; print(json.load(sys.stdin).get('id') or '')")

  local resume_out resume_exit
  if [ -n "$rid" ]; then
    resume_out=$("$INS" runs resume "$rid" --workspace "$ws" 2>&1)
    resume_exit=$?
  else
    resume_out="(no run recorded yet)"
    resume_exit=0
  fi

  local unique_err seq_reuse db_locked
  echo "$resume_out$killed_steps" | grep -qi "UNIQUE constraint" && unique_err=true || unique_err=false
  echo "$resume_out" | grep -qi "locked\|SQLITE_BUSY" && db_locked=true || db_locked=false

  # post-resume integrity: steps monotonic, single run row, closed status
  local integrity="n/a"
  if [ -f "$ws/.inspector/runs.db" ]; then
    integrity=$(node -e "
      const Database = require('C:/Users/Michael Roy/AppData/Roaming/npm/node_modules/inspector-cli/node_modules/better-sqlite3');
      try {
        const db = new Database(process.argv[1], { readonly: true });
        const runs = db.prepare('SELECT COUNT(*) c FROM runs').get().c;
        const seqs = db.prepare('SELECT sequence FROM steps ORDER BY sequence').all().map(r => r.sequence);
        let dup = false;
        for (let i = 1; i < seqs.length; i++) if (seqs[i] === seqs[i-1]) dup = true;
        const actions = db.prepare('SELECT COUNT(*) c FROM actions').get().c;
        console.log(JSON.stringify({ runs, steps: seqs.length, duplicateSequences: dup, actions }));
      } catch (e) { console.log(JSON.stringify({ dbError: String(e).slice(0,120) })); }
    " "$ws/.inspector/runs.db" 2>&1)
  fi

  LABEL="$label" DELAY_MS="$delay_ms" KILLED_STATE="$killed_steps" \
    RESUME_EXIT="$resume_exit" UNIQUE_ERR="$unique_err" DB_LOCKED="$db_locked" \
    INTEGRITY="$integrity" RESUME_TAIL="$(echo "$resume_out" | tail -3 | tr '\n' ' ')" \
    RESULTS_FILE="$RESULTS" python - <<'PYEOF'
import json, os
row = {
    "label": os.environ["LABEL"],
    "delayMs": int(os.environ["DELAY_MS"]),
    "killedState": json.loads(os.environ.get("KILLED_STATE") or "{}"),
    "resumeExit": int(os.environ["RESUME_EXIT"]),
    "uniqueConstraintError": os.environ["UNIQUE_ERR"] == "true",
    "dbLocked": os.environ["DB_LOCKED"] == "true",
    "integrity": json.loads(os.environ["INTEGRITY"]) if os.environ["INTEGRITY"].startswith("{") else os.environ["INTEGRITY"],
    "resumeTail": os.environ["RESUME_TAIL"][:300],
}
open(os.environ["RESULTS_FILE"], "a", encoding="utf8").write(json.dumps(row) + "\n")
PYEOF
  rm -rf "$ws"
}

for d in 5500 6500 7500 8500 9500 10500 11500; do
  run_one "kill@${d}ms" "$d"
done
# repeat the two most interesting timings 4 more times each for soak depth
for i in 1 2 3 4; do
  run_one "kill@7500ms-r$i" 7500
  run_one "kill@9500ms-r$i" 9500
done
echo DONE
