# ADR-0594: Keep knowledge publication moving and apply owner rules on every host

Status: `accepted`
Decision date: 2026-11-19
Amends: [ADR-0473](../documents/0473-publish-knowledge-within-its-write-scope-and-never-rewrite-a-tool-generated-document.md) (the default roots widen to an active delegation, skill files publish only from practice, and the repair counts Lervo's own repair commits as Lervo's), [ADR-0545](../documents/capture/0545-apply-owner-stated-rules-without-a-review-command.md) (the Node resident worker applies stored owner rules too, and apply failures are recorded)

## Context

On 2026-11-19 background knowledge for the lervo repository had stopped reaching `origin`, and two owner rules had waited 7 and 18 days without being applied. The causes:

- **Publication blocked since 2026-11-14 14:39 UTC.**
  - The WSL owner had recorded 2,097 attempts of `knowledge_publication_scope_violation` for `.agents/skills/deploy-lervo-release/SKILL.md`.
  - A normalization had rewritten that skill. The delegation lets the normalizer write `.agents/skills`, but the owner's publication setting had no `scope`, so it meant the fixed roots `docs/` and `.lervo/knowledge/` and refused the path.
- **The repair could never finish.**
  - A repair commit had restored the skill, and a later normalization rewrote it again.
  - The repair plan built Lervo's run of commits from the newest and stopped at the repair commit, so the earlier Lervo change looked like a person's change (`developer_change`), and the repair blocked itself on every cycle.
- **The local branches diverged.** Unpublished knowledge commits kept landing on the owner's local `main`, 50 by then, while `origin/main` moved 382 commits ahead. The replica carried the same history to the Mac.
- **No host applied owner rules.**
  - Only the CLI host passed the owner-rule step to the resident worker. The WSL owner runs the Node resident worker, which never applied stored rules, and the Mac skipped them because it is not the owner.
  - Every apply failure was also swallowed as `deferred`, so nothing reported the delay.
  - The Mac's convergence status showed its own obligation from 2026-11-02 as if it were the live state.

## Decision

1. **Skill files are not normalized.**
   - A path under `.agents/skills`, `.claude/skills`, or `.codex/skills` is never eligible for normalization, whatever the delegation's roots say. Skills are executable agent instructions, and a prose rewrite can change what an agent does.
   - A protected path is therefore never pending and never counted as normalization debt in health or upgrade. Like a parked document, it never holds normalization review or lifecycle verification.
   - An existing normalization record for a skill is ignored and never regenerated.
   - Publication admits a change to those paths only from a practice-materialization commit (`Lervo-Practice-Candidate` trailer, ADR-0543).
   - Other normalization roots are unchanged: docs, README, AGENTS.md, CLAUDE.md.
2. **The default roots widen to an active delegation.**
   - Publication settings that hold the default roots (`docs/`, `.lervo/knowledge/`) also admit the active delegation's canonical and normalization roots. Without a `scope`, settings parse to those default roots, so the owner's settings stop refusing what the normalizer was delegated to write.
   - Without an active, unexpired delegation the default roots keep their fixed meaning. Other explicit `allowedRoots` and `scope: "delegation"` are unchanged.
3. **The repair counts only real developer changes.**
   - For an out-of-scope path, every unpublished commit of the path must be a `Lervo Knowledge` commit; an earlier repair commit counts as Lervo's own. The path is then restored to the publication base.
   - A commit by anyone else still blocks with `developer_change`.
4. **Every host applies stored owner rules the same way.**
   - The apply logic moves to `@lervo/repository-knowledge-runtime`, and both the CLI host and the Node resident worker pass it to the worker.
   - The convergence owner applies, whichever runtime it uses, and every host behaves the same.
5. **Failures are visible.**
   - A candidate that fails to apply keeps its last failure code, first and last failure time, and attempt count in `.lervo/state/knowledge/instruction-apply-failures.json`. The file is private, mode 0600, holds at most 64 records, and drops a record once its candidate is applied. Attention shows the record.
   - A host that does not own convergence reports its own observation with coverage `stale` and reason `maintenance_owner_elsewhere`.

## Consequences

**Recovery on the WSL owner, after it installs this release:**

1. The next cycle repairs the skill: it restores the file to the publication base, which is the current `origin/main` version.
2. Publication then replays the unpublished knowledge commits onto `origin/main` and updates the knowledge pull request.
3. Commits that conflict with newer `origin/main` changes are superseded and generated again later. The owner decided on 2026-11-19 not to recover them by hand.
4. After the merge, the local `main` catches up, and the replica carries it to the Mac.
5. The two waiting owner rules are applied and committed on the owner.

**Other effects:**

- A practice-learned skill still publishes. A person's or agent's edit to a skill still goes through a normal pull request.
- **Rollback:** revert this change. Publication would then block again on the same skill file.

## Verification

**Publication** (`packages/repository-knowledge-runtime/test/knowledge-publication-scope.test.ts`):

- the change, repair and change-again sequence restores to the base, and a person's commit still blocks;
- a skill change publishes only from practice;
- the default roots widen to an active delegation and keep their meaning without one.

**Owner rules and status:**

- `instruction-apply-failures.test.ts` covers the failure records and the protected skill paths;
- `document-tool-ownership.test.ts` checks that a skill is never pending normalization;
- `normalization-protected-skill.test.ts` checks that a skill as the only pending document still lets the later stages run;
- `apps/node-runtime/test/repository-knowledge-loop-owner-rules.test.ts` covers the Node worker applying stored rules;
- `maintenance-status.test.ts` covers a non-owner's stale observation.
