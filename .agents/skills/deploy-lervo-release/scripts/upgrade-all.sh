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
summary() { python3 -I -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('status'),'applied=',d.get('appliedStages'),'skipped=',[s.get('stage') for s in d.get('skippedStages') or []],'notices=',[n.get('stage')+': '+n.get('undo','') for n in d.get('notices') or []],'lint=',d.get('knowledgeLint'),'err=',(d.get('error') or {}).get('code'),(d.get('error') or {}).get('message','')[:300])" "$1" 2>/dev/null; }
status_of() { python3 -I -c "import json,sys;print(json.load(open(sys.argv[1])).get('status'))" "$1" 2>/dev/null; }
while IFS= read -r root; do
  [ -z "$root" ] && continue; name=$(basename "$root"); final="?"
  for i in 1 2 3 4 5; do
    lervo upgrade --root "$root" --json > "$out/$name.plan$i.json" 2> "$out/$name.plan$i.stderr"
    status=$(status_of "$out/$name.plan$i.json")
    # ADR-0561: lervo_debt is Lervo's own held work, never an owner step; it is reported, not failed.
    if [ "$status" = "current" ] || [ "$status" = "lervo_debt" ]; then final="$status"; break; fi
    # `--apply` plans again inside the exclusive window and applies that plan; no plan ID is echoed.
    # Each round keeps its own apply receipt; $name.json is a copy of the latest one.
    apply="$out/$name.apply$i"
    lervo upgrade --root "$root" --apply --json > "$apply.json" 2> "$apply.stderr"
    cp "$apply.json" "$out/$name.json"; cp "$apply.stderr" "$out/$name.stderr"
    echo "$name round $i: $(summary "$out/$name.json")"
    final=$(status_of "$out/$name.json")
    { [ "$final" = "current" ] || [ "$final" = "lervo_debt" ]; } && break
    [ "$status" != "ready" ] && break
  done
  echo "== $name: $final"
  [ "$final" = "current" ] || [ "$final" = "lervo_debt" ] || failed=$((failed + 1))
done <<< "$reg"
# Any repository that did not reach current or Lervo debt fails the run, so a caller never reads it as done.
[ "$failed" -eq 0 ] || { echo "$failed repositories not current" >&2; exit 1; }
