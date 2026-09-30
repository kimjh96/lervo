# Product routes

| Route | CLI prefix | Authority | Contract |
| --- | --- | --- | --- |
| `product_activity.inspect` (v8) | `application activity --json` | read-only | [Activity](product/activity.md) |
| `product_search.inspect` (v9) | `application search --corpus repository_knowledge --json <query>` | read-only | [Search](product/search.md) |
| `product_observability.inspect` (v10) | `application observability --work <work-id> --json` | read-only | [Observability](product/observability.md) |
| `product_deliberation.inspect` (v11) | `application deliberation --deliberation <id> --integration <id> --json` | read-only | [Deliberation](product/deliberation.md) |
