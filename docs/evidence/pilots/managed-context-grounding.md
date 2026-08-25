# Managed context grounding acceptance pilot

- Date: 2026-08-24
- Providers: installed Codex and Claude Code
- Scope: local managed execution without Hub or npm publication

## Result

Both providers modified only `src/result.ts` in an isolated temporary repository. The tracked `project.pilot` verification and separate read-only writing-publication evaluation passed. CLI output used natural prose without E4 metadata.

| Provider | Run | Delivery | Explicit reference | Missing stages |
| --- | --- | ---: | ---: | --- |
| Claude | `run_3099f30f825a46aabf80c8828fb542c6` | 1 / 1 | 1 / 1 | none |
| Codex | `run_d70271a33f5e45fe936b30984e59e2ca` | 1 / 1 | 1 / 1 | none |

Each full local trace passed event-chain integrity, retained both E1 grounds for `AGENTS.md`, reconstructed the exact E2 version and E3 receipt, and validated one E4 output citation. Internal use remained `unsupported`; relevance was unavailable without reviewed ground truth.

Source and publication digests differed because the source contained the exact E4 comment and the human-facing artifact did not:

| Provider | Captured source digest | Human-facing publication digest |
| --- | --- | --- |
| Claude | `sha256:6bea7a64ed9e8014f17033e388f2eff053a42953678c5b87cf54f2b28523f46e` | `sha256:6cd00ca3e474c1c993a4d33cf52647f9f257068e06c9f92ac1fa3b22bae061f8` |
| Codex | `sha256:db430240f633736c9caad3fd638db25242df2955b4d0eb94dff2cce92293750f` | `sha256:3bd50907d18e0a8da33900e72f76dbcab4c407eb133aec55de76859a39de1032` |

The temporary repository had no Hub configuration and was removed after evidence capture. This pilot demonstrates provider parity and local availability only; it does not claim model understanding or internal document use.
