# Writer rollback

Using a release capable of reading every existing envelope version, plan and apply a return to version 1 writing:

```text
lervo event-contract rollback --json
lervo event-contract rollback --apply <plan-id> --json
```

Verify that status selects version 1, then replay the complete mixed chain. Keep all readers capable of reading every existing envelope version, including version 3 where present. Rollback proves only the future writer selection; it neither removes higher-version events nor reverses another deployment or proves Node and Hub health.

A failed reader deployment may return to a version 1-only release only when the repository contains no higher-version history. Once higher-version events exist, deploy a fixed reader that supports every version in that history.
