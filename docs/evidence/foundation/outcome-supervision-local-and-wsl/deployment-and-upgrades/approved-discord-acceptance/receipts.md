# Discord acceptance message and evidence receipts

## Grouped requests

| Group | Request | Elio response | Canonical result |
| --- | --- | --- | --- |
| Final five scenarios | `1548585658199572554` | `1548587057931223081` | `sha256:24eb3bcf5c12fa543723c74da319ec44cd47a49d724abb5f965c2e7da3b765db` |
| Corrected four scenarios | `1548587086066749494` | `1548588230910410893` | `sha256:9d8f4d92e9222d68f683a11c287b95dacf9dccfd4c91952137ffd23650914eeb` |

Both completed once through the same native Elio provider session, with no recorded failure code.

## Delivery and replay

Final #lervo publication: `1548590944087965707`. Content hash: `sha256:2f364c97ee99296c5a34b96a23ba2a424bc37948d4a668b5dd593f739bf86e35`. Exact author, channel, and bytes matched on readback. Initial delivery made one POST; in-process replay and replay after reopening the durable store made zero additional POSTs. This verifies real transport and replay, not an induced Discord outage.

## Evidence references and acceptance boundary

Complete receipt manifest: `sha256:53fbd6c81c854540b2bafc1a9c96b73b59796c0aa90a60c8d00b52c3aee636a4`. It binds raw Discord results, fixture reports, exact fleet observation, repository upgrades, workspace repair, globals, coordinator, retained service definitions, source reconciliation, and the full-suite report.

The individual existing-result and staff-reuse response observation is retained separately: `sha256:ef6b9dd5d6d30c0769e49a90b122e89aed524eaa5547fc071662e2d3c38d85c8`.

The original six stages have substantial implemented, tested, and deployed behavior. Their remaining common gate is full positive installed supervision acceptance. Keep the [unresolved scenario observations](scenario-results.md) explicit; successful Discord exchange alone cannot close that gate.
