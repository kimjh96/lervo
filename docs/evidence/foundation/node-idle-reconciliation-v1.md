# Node idle reconciliation observation

Status: recorded
As of: 2026-09-11

- [macOS read-only benchmark](node-idle-reconciliation-v1/macos-benchmark.md): scope, measurements, reproduction, and claim boundaries for the exact observed history.
- [Separate installed WSL observation](node-idle-reconciliation-v1/installed-wsl.md): bundle verification, live process CPU windows, and installed ADR-0397 hint behavior.

The macOS benchmark does not demonstrate installed fleet savings. The WSL observation verifies the installed ADR-0397 path, not the later ADR-0399 follow-up. Neither establishes temperature/fan causality. Periodic audits retain nonzero cost and the detection window in the [specification](../../specifications/coordination/node-idle-reconciliation.md).
