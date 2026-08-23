# Shiflo v0 acceptance pilot

Status: `passed`
Date: 2026-08-24

## Scope

The pilot used the built Lervo CLI against the existing dirty Shiflo monorepo without a Hub, npm publication, commit, or push. Installed Codex `0.148.0` and Claude Code `2.1.226` supplied the provider sessions.

## Repository knowledge

- Initialization added only the missing document-layout policy.
- Structural layout plan `klayout_66e30a39ff4b1fe82dd7b706` moved 53 Lervo machine artifacts into two-hex shards and moved no user documents.
- Knowledge plan `kplan_b5886431a55af5da591d5ef3` created bounded `docs/knowledge` navigation, removed the five obsolete generated root `knowledge` pages, and adopted legacy generation ownership without conflicts.
- Final evidence refresh plan `kplan_947eade6017cae20e616bcbb` updated the generated manifest and knowledge index after managed runs.
- Semantic layout plan `klayout_84b4c35bfdd9970245e6d06a` then moved 21 Claude rules into routed `docs/instructions` groups, one skill into `.agents/skills`, and seven ordinary documents from legacy root, `docs`, application, and prototype locations. It updated 11 references in the same approved durable transaction.
- Bridge plan `kbridgeplan_66dc7ac6c80ea4a240bec8f4` appended only the bounded `@AGENTS.md` managed block to the existing CLAUDE entrypoint. Repair plan `klayout_bf7901a0177c26aaf54174ef` corrected eight route or provider-path references after brace-aware legacy glob parsing was hardened. Bridge refresh `kbridgeplan_88037632f4440edeca02174c` bound the final user-authored Claude wording and generated knowledge without another user-target change.
- Documentation-root plan `klayout_04d4497e04b49e53247ed63a` moved the substantive legacy `docs/README.md` policy to `docs/repository/documentation-governance.md` and updated the root README reference. A subsequent semantic pass normalized its path literals to repository-root form; bridge refresh `kbridgeplan_11a59ba84c46bc445bc7a8f9` rebound generated knowledge without changing CLAUDE.
- The final bounded scan covered 1,659 included sources, 9 excluded sources, and 69 unsupported sources. It reported 25 agent surfaces: 24 semantic sources, one local-inventory-only tool configuration, no review-required legacy surface, and no nonstandard surface.
- Replanning produced zero changed operations, lint passed with 43 checked concepts and no issues, and repository search found no remaining `.claude/rules` or `.claude/skills` reference outside ignored Lervo history.

## Managed providers

- Codex run `run_84498e142dc1414ca7c7dfbee03576a0` created only the declared pilot file. Suite `lervo.pilot.codex` passed, the separate Codex semantic evaluation passed, and the CLI exited 0.
- Claude first omitted one required period. Suite `lervo.pilot.claude` failed and Lervo emitted no successful run completion for that attempt.
- Claude run `run_78c5431bea1d43da9ca80845dedde591` corrected only the declared pilot file. The suite, separate Claude semantic evaluation, publication permit, and CLI exit all passed.
- The pilot file was removed after verification. The two suite definitions remain because historical verification events bind to their exact suite hashes and cannot be revalidated safely without them.

## Defects closed by the pilot

The external repository exposed and closed portability gaps in fresh taxonomies, legacy manifest adoption, lexical matching, native build exclusions, semantic document relocation, documentation-root README handling, provider-neutral instruction routing, portable skill placement, legacy brace-glob parsing, and stale provider references. It also exposed the missing production semantic-evaluator composition; ordinary managed runs now use an isolated read-only local provider evaluation and a role-bound result protocol.

This report proves the observed local runs and repository state only. It does not prove provider understanding, use of every injected document, Hub transfer, npm publication, clean-clone installation on another operating system, or future run success.
