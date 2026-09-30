# WSL boot-path repair

The designated WSL execution side is reachable again. Arca-next's blocking `Type=oneshot` Compose service on `multi-user.target` caused its startup delay. A boot timer now starts the same service after the target becomes available.

A controlled reboot reached `graphical.target` in 4.050 seconds, the first Ubuntu command in 4.334 seconds, and five warm commands in 58–97 milliseconds. Arca-next subsequently started successfully. This proves boot-path repair; the earlier host shutdown's cause and long-run recurrence remain unverified. The Mac checkout cannot substitute for WSL's version-3 event writer.
