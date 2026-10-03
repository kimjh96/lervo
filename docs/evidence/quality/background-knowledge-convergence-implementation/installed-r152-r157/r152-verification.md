# r152 debt and service verification

## Rollout and currency

The private r152 Node/CLI rollout reached Lervo, Shiflo, Plen, Flemo, Digimon, and Arca-next. AXLI retained its earlier version and two active work claims.

Lervo/Shiflo full migrations applied; lint reported zero errors and respectively 110/eight stale-normalization warnings. Plen applied managed terminal-hook and complete knowledge migrations, then linted with zero errors/warnings. Its later currency check still found pending migration/instruction-bridge projections: lint did not establish complete currency. Flemo's unsupported symlink and Digimon's oversized source set still needed reviewed classification/authority.

## Service verification

Service PATH includes the bound Node runtime and standard system directories, excluding ambient `pnpm`/`bun`. Lervo normalization verification failed invoking `pnpm`; Shiflo failed invoking `bun`.

Lervo's default suite now uses `node --run` for lint/typecheck and resolves Vitest's module entrypoint in the changed-runtime runner. Shiflo uses exact Node TypeScript/asset validators. These commands passed under the observed service PATH, but source changes did not establish a new background apply. Lervo rolled back; no partial document write was accepted as current.

## Source-ordering defect

After two reviewed Shiflo normalization batches, the third generation stopped with `knowledge_compile_policy_violation`. The binder used `localeCompare` for source tuples but default string ordering for explicit selections, allowing mixed-case/punctuation paths to fail exact-source validation. Both now use default string order. The mixed-case regression and existing normalization coverage passed 28 Mac tests. Installed r152 predates the fix; installed confirmation remained required.

Lervo retained normalization/lifecycle debt, with no newly observed human Discord request/managed response.
