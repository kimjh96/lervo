#!/usr/bin/env bash
# Usage: upgrade-all.sh <receipt-dir>
# Upgrades every repository in this host's Lervo registry until current, keeping receipts.
set -u
out="$1"; mkdir -p "$out"
reg=$(python3 -I -c '
import json,os,sys
for p in [os.path.expanduser("~/Library/Application Support/Lervo/repositories.json"), os.path.expanduser("~/.local/state/lervo/repositories.json")]:
    if os.path.exists(p):
        d=json.load(open(p)); items=d.get("repositories",d) if isinstance(d,dict) else d
        print("\n".join(r.get("root") or r.get("repositoryRoot") for r in items)); break
else:
    sys.exit("no Lervo repository registry on this host")')
[ $? -eq 0 ] && [ -n "$reg" ] || { echo "registry unreadable or empty" >&2; exit 2; }
failed=0
summary() { python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('status'),'applied=',d.get('appliedStages'),'skipped=',[s.get('stage') for s in d.get('skippedStages') or []],'lint=',d.get('knowledgeLint'),'err=',(d.get('error') or {}).get('code'))" "$1" 2>/dev/null; }
while IFS= read -r root; do
  [ -z "$root" ] && continue; name=$(basename "$root"); final="?"
  for i in 1 2 3 4 5; do
    lervo upgrade --root "$root" --json > "$out/$name.plan$i.json" 2> "$out/$name.plan$i.stderr"
    status=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('status'))" "$out/$name.plan$i.json" 2>/dev/null)
    plan=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('planId'))" "$out/$name.plan$i.json" 2>/dev/null)
    if [ "$status" = "current" ]; then final="current"; break; fi
    if [ "$status" = "ready" ]; then
      lervo upgrade --root "$root" --apply --approval "$plan" --json > "$out/$name.json" 2> "$out/$name.stderr"
      code=$(python3 -I -c "import json,sys;print((json.load(open(sys.argv[1])).get('error') or {}).get('code',''))" "$out/$name.json" 2>/dev/null)
      [ "$code" = "upgrade_plan_changed" ] && lervo upgrade --root "$root" --apply --safe --json > "$out/$name.json" 2> "$out/$name.stderr"
    else
      lervo upgrade --root "$root" --apply --safe --json > "$out/$name.json" 2> "$out/$name.stderr"
    fi
    echo "$name round $i: $(summary "$out/$name.json")"
    final=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('status'))" "$out/$name.json" 2>/dev/null)
    [ "$final" = "current" ] && break
    [ "$status" != "ready" ] && break
  done
  echo "== $name: $final"
  [ "$final" = "current" ] || failed=$((failed + 1))
done <<< "$reg"
# Any repository that did not reach current fails the run, so a caller never reads it as done.
[ "$failed" -eq 0 ] || { echo "$failed repositories not current" >&2; exit 1; }
