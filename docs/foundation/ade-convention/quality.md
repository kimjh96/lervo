# Lervo ADE quality requirements

Status: `proposed`
As of: 2026-11-22

This part of the [Lervo ADE convention](../ade-convention.md) covers the quality areas around the requirements the owner named.

The owner named the core, structure, performance, cloud readiness, localization, and providers, and asked that the requirements around them be covered as well. These rules apply with the same weight.

## Reliability and data integrity

- A UI crash never affects a session. A session host crash ends only its own processes. A supervisor restarts the session host, and conversations recover from the provider transcript.
- No user input is lost. The composer keeps its draft across reloads and restarts.
- Every state the ADE needs can be rebuilt from canonical sources. Presentation state is only a cache.
- Failures carry typed codes from end to end. The UI never shows a raw stack trace.

## Security

- The local channel accepts only the owning OS user, through owner-only socket permissions and a token issued at each start.
- The webview loads only bundled code. A strict content security policy forbids remote scripts and `eval`. Each feature gets only the Tauri capabilities it needs.
- The UI cannot start processes. It asks the session host, which accepts only launch descriptors that Lervo prepared.
- Each receiving boundary validates every protocol message against its schema.
- Updates are signed. Installation verifies the signature before it replaces anything.
- Dependencies pass `cargo deny` and the repository's dependency checks. Each release includes the SBOM that Lervo already generates.

## Privacy

- The ADE sends no telemetry. Diagnostics stay on the host.
- Logs and events hold no prompt text, tool input, tool output, credentials, or absolute paths, as Lervo's event rules require.

## Accessibility

- Every action is reachable from the keyboard, and a command palette lists all of them.
- Interactive elements are native controls with accessible names. Focus moves predictably when panes open and close.
- Text meets WCAG AA contrast in both themes. The UI follows the OS settings for reduced motion, reduced transparency, increased contrast, and text size.
- Color never carries status alone. Each status dot has a text equivalent.

## Compatibility and updates

- The protocol negotiates its version during the handshake. A UI and a session host one minor version apart still work together.
- Settings and on-disk indexes carry schema versions and migrate forward. A failed migration keeps the old data and rebuilds the projection.
- The adapter detects the provider CLI version at launch and maps it to capabilities. An unknown version falls back to the CLI conversation.
- The ADE follows Lervo's install and rollback rules for the Lervo CLI it depends on.

## Cross-host parity

- The ADE behaves identically on macOS, Linux, and WSL. Platform differences, such as paths, line endings, and shells, stay inside platform adapters.
- A conflict between hosts is resolved through coordination, never by limiting a feature to one host.

## Observability

- The session host and the UI write structured, leveled logs with a size limit and rotation.
- A diagnostics view shows the live counters that the performance harness measures. `lervo doctor` reports the ADE's health.

## Testing

- Each layer has unit tests for its own decisions. Domain tests need no OS mocks.
- The protocol has contract tests in which Rust and TypeScript encode and decode the same fixtures.
- Provider adapters pass the common contract suite.
- An end-to-end smoke test starts work from an instruction on each host type.
- The soak test and the performance harness guard against leaks and regressions.
