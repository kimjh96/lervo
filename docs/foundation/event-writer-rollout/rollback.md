# Writer rollback

Use a release that can read every existing envelope version to plan and apply a return to version 1 writing:

```text
lervo event-contract rollback --json
lervo event-contract rollback --apply <plan-id> --json
```

Verify that status selects version 1, then replay the complete mixed chain. Keep all readers capable of reading every existing envelope version, including version 3 where present.

Rollback proves only future writer selection. It does not remove higher-version events, reverse another deployment, or prove Node and Hub health.

A failed reader deployment may return to a version 1-only release only if the repository contains no higher-version history. Once higher-version events exist, deploy a fixed reader that supports every version in that history.
