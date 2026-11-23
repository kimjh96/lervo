# Verification versions four–eight

## Version four and five timeouts

Lervo's reviewed three-document apply started at 05:53:25 UTC. Version four passed lint in 33.5 seconds and typecheck in 30.9 seconds. Risk planning found 353 changed paths and 22 opaque runtime triggers, selected full Vitest, and hit the exact 900-second command limit. Private CAS `ver_1abb15f8ec3549fa` records `repository-risk-based-tests: timed_out`; rollback occurred at 06:12:12 UTC with `knowledge_apply_failed`. This proven cause is distinct from the earlier nonspecific failure. ADR-0621 versions the first bounded correction.

Version-five grant bound `sha256:24a0e3896e8c611de24568ce85398c4fa919949591d74956a872149d316690a5`. Full Vitest reached its 1,800-second cap on busy WSL; the worker logged `knowledge_job_transient_failure` at 07:45:01 UTC. Grant expiry then produced `knowledge_authority_unavailable`, with 210 normalizations/three lifecycle reasons outstanding. No version-five success/apply is claimed. The same Codex-only roots/providers/ceilings were re-reviewed through 09:00 UTC. ADR-0622 requires a new exact suite binding and installed pass before currency.

## Versions six and seven

Version-six suite `sha256:6f438983f25f56f93c097f22a2abbe3d9f8f34f1ecb0515b791247fdaf74c52e` was installed/reviewed. First Mac shard passed 218 files/1,011 tests in 134 seconds. Shard two failed because the plan test used Node's test API and distribution called `process.umask()` in a Vitest thread. The plan test was corrected; focused distribution/plan tests passed with forks. Installed version-six apply failed with `knowledge_apply_failed`, event 45434 at 08:24:56 UTC; the exact child failure still required receipt inspection. No version-six pass is claimed.

ADR-0623 adds version seven, hash `sha256:7887fb9b8d1e6ebe64256a505e30f10c2e45944437b0992882c397daf7e89fea`. Its grant correctly refused while prior materialization was active, then applied afterward. Neither active-transaction recovery nor version-seven success was claimed.

Mac version-seven shards one/three/four passed after build and manifest/SBOM regeneration. A second shard-two run failed only two Node tests' default five-second deadlines under concurrent load; both files passed 14 tests at 15 seconds. Lervo systemd PATH omitted `pnpm`, which release tests spawn. A Node-specific override added the installed local executable directory; controlled restart left service/Hub healthy. Focused WSL release/distribution tests passed 11/11. Mac/WSL rebuilt CLI dist and release-manifest hashes matched. ADR-0624 adds version eight, hash `sha256:73ef552040b998c437f4898efb4935a409ac42f96a05db233c1de800c3c62d26`; no installed passing apply existed yet.

## Version-eight failures and targeted corrections

Reviewed WSL version-eight authority retained Codex-only roots/ceilings through 11:00 UTC. Mac shard two passed 217 files/1,069 tests.

### First apply: privacy-test timeout

First installed apply reached shard one, then rolled back at event 46697, 09:28:12 UTC. Direct WSL repeat identified the tracked-secret privacy test in `packages/repository-knowledge-runtime/test/worker.test.ts` at its explicit 30-second cap: 1,010 tests passed, one failed; cleanup error followed timeout. Its cap became 90 seconds, matching adjacent full-worker tests, while preserving privacy assertions and the 1,800-second command cap. Focused WSL privacy coverage passed; an installed passing apply remained required.

### Second apply: AppleDouble lint failure

Second apply rolled back before shards at event 47153, 09:50:24 UTC. The stored version-eight receipt shows `repository-lint` exit 1 on `packages/repository-knowledge-runtime/test/._worker.test.ts`. That AppleDouble and two documentation sidecars came from macOS tar transfer. All three were removed; WSL `pnpm lint` passed. Future Mac→WSL archives must disable macOS copyfile metadata. A new content-bound baseline and installed pass remained required.

### Third apply: multi-cycle worker deadlines

Third apply passed lint/typecheck but failed shard one after 386 seconds, event 47757 at 10:12:11 UTC. `ver_c9b15d2f346e5fc2` reports 1,009 passing tests and two worker tests reaching explicit 90-second caps; `ENOTEMPTY` followed those deadlines. These multi-cycle tests now allow 240 seconds, with assertions and the 1,800-second shard cap unchanged. Both passed together on WSL, 2/2 in 82.16 seconds. Sufficiency still required another installed apply.

### Next baseline: isolated dependency preparation

The next baseline reached canonical integration and failed before shards, event 48196 at 10:25:58 UTC. Isolated candidate lint passed, but typecheck could not resolve internal workspace packages without dependency links/built declarations. Frozen offline pnpm install succeeded in that worktree. ADR-0625 adds version-nine isolated preparation; build, source-bearing integration ref, reviewed grant, and installed passing results were then pending.
