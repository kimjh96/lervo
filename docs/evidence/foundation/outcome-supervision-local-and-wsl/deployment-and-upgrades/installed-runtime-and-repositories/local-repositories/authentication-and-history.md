# Authentication repair and history divergence

Six registered Mac Nodes had bearer values differing from their existing project-scoped Hub credentials. Existing values were restored to owner-only files and reloaded with SIGHUP. No Hub credential, principal, permission, destination, or configuration changed. All six authenticated requests then returned HTTP 200 with the expected Hub identity.

- Apply: `sha256:af51b260f9a836d56365e1ddd626d207e23103b7e9de487de3c01df6d113892a`.
- Authenticated verification: `sha256:3bcf908fbbca065bc75324f9b7bc462243c858b4ed773e8945e73e84f28c5293`.

Arca and Arca-data returned to ready synchronization. The other four failed because the authenticated Hub cursor did not match their local event chain. A read-only comparison confirmed divergence rather than a missing suffix:

| Repository | Last common sequence | Local head | WSL head |
| --- | ---: | ---: | ---: |
| Plen | 110 | 149 | 749 |
| Flemo | 3564 | 3579 | 3688 |
| Shiflo | 2151 | 2320 | 3598 |
| Arca-next | 735 | 1284 | 2174 |

Comparison: `sha256:5b09f0343f3be662cf9e349d4ee576759f25f66006d408f190212d152a2c3741`.

The four Mac services were unloaded to stop repeated startup failures. Installed definitions, both event histories, and repository bytes were retained. Hold receipt: `sha256:1401449b7d93ee3b0d2bef24378fd517472072b494b7fa615d681765e988ee38`.

No history was replaced; synchronization is not claimed for these repositories. AXLI's separately recorded history divergence also remains unresolved.
