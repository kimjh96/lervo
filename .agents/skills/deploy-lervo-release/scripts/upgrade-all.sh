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
summary() { python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('status'),'applied=',d.get('appliedStages'),'skipped=',[s.get('stage') for s in d.get('skippedStages') or []],'lint=',d.get('knowledgeLint'),'err=',(d.get('error') or {}).get('code'),(d.get('error') or {}).get('message','')[:300])" "$1" 2>/dev/null; }
while IFS= read -r root; do
  [ -z "$root" ] && continue; name=$(basename "$root"); final="?"
  for i in 1 2 3 4 5; do
    lervo upgrade --root "$root" --json > "$out/$name.plan$i.json" 2> "$out/$name.plan$i.stderr"
    status=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('status'))" "$out/$name.plan$i.json" 2>/dev/null)
    plan=$(python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('planId'))" "$out/$name.plan$i.json" 2>/dev/null)
    if [ "$status" = "current" ]; then final="current"; break; fi
    # Each round keeps its own apply receipt; $name.json is a copy of the latest one.
    apply="$out/$name.apply$i"
    if [ "$status" = "ready" ]; then
      lervo upgrade --root "$root" --apply --approval "$plan" --json > "$apply.json" 2> "$apply.stderr"
      code=$(python3 -I -c "import json,sys;print((json.load(open(sys.argv[1])).get('error') or {}).get('code',''))" "$apply.json" 2>/dev/null)
      if [ "$code" = "upgrade_plan_changed" ]; then
        apply="$out/$name.apply$i.safe"
        lervo upgrade --root "$root" --apply --safe --json > "$apply.json" 2> "$apply.stderr"
      fi
    else
      lervo upgrade --root "$root" --apply --safe --json > "$apply.json" 2> "$apply.stderr"
    fi
    cp "$apply.json" "$out/$name.json"; cp "$apply.stderr" "$out/$name.stderr"
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
