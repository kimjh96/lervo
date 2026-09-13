# Windows forwarding recovery

During rollout, the Windows WSL localhost relay accepted connections but timed out forwarding to the healthy Hub. Lervo and Shiflo failed readiness and rolled back; both later passed a new exact-predecessor upgrade. Restarting the unchanged Hub did not restore the relay.

A private-interface systemd socket proxy, a Windows loopback-only port proxy, and an exact Tailscale Serve upstream change restored the existing HTTPS endpoint. Hub credentials, identity, executable bytes, and configuration remained unchanged. The two observations 58.456 seconds apart in [earlier transitions](earlier-transitions.md) verify local and HTTPS health.

- Proxy installation: `sha256:cad8f5a2402c1de04f57e1b6667cb837d776ed29a1bd126297bd165b3fb49abd`.
- Windows transition and exact rollback: `sha256:c0e39fd11b679ddfc97962c66841f7870ce3d44a4e61836686789780e2f38dd9`.

At 00:02:21 UTC on 2026-09-13, the previously authorized Windows restart was requested to recover stalled new WSL launches. SSH returned at 00:06:53 UTC, and a new WSL command completed. Windows and WSL boot identities changed. Hub and all seven Nodes started automatically with the then-current Node bundle `1d13818d` and expected configuration hashes. Two observations 43.442 seconds apart retained the same PIDs, ready health, and zero restarts. Local and HTTPS Hub health returned 200 with the expected identity.

- Restart verification: `sha256:d523813f4593012df53d27a746d402f48e77d20cbf92c57f012a792396e31130`.
- Mac authenticated requests also returned 200: `sha256:f386d6e71091abc3be90abcbb64febc2ce4c6500e65ee52b97b61dcb78acf271`.

The private WSL address remained `172.29.227.1` during this restart, so existing forwarding worked without another configuration change. Reobserve the address after future VM restarts; this observation does not establish recovery from an address change.
