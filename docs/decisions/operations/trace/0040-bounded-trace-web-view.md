# ADR-0040: Read-only trace web view without accumulated pages

Status: `accepted`
Decision date: 2026-08-19

## Context

The authenticated API had no human navigation. Appending every run/event into one screen recreates long-document problems and grows browser memory with history. A web view must not bypass HTTP authorization or persist bearer credentials in URLs, markup, or browser storage.

## Decision

### Public shell, authenticated data

- `GET /trace` returns a data-free HTML shell. Serve JavaScript/CSS only at fixed `/assets/` routes; never derive filesystem paths from input.
- Shell/assets invoke neither authenticator nor trace source.
- Keep an entered token only in a page JavaScript variable, clear the input before requests, and never place it in query, fragment, HTML, local/session storage, or cookies.
- Send it only as Authorization to same-origin `/v1/trace`, without cookie credentials. Clear references on disconnect, 401, and unload. This does not prove removal from browser-process memory or user federation.

### Three independent pagers

- Separate project, run, and event regions. A project selection is required before runs and a run before events.
- Display one API cursor page per region and replace its DOM items on navigation. Keep only backward cursor stacks in tab memory; do not accumulate event source.
- Default web page size is 20; API maximum remains 100.
- Changing project page clears run/event selection; changing run page clears event selection. Ignore late responses not matching current pager. A failed next-page request preserves current position.
- Label `continuous` as “Continuous history” and `buffered` as “Awaiting predecessor,” using both text and color. Show human descriptions for known event fields while preserving IDs/hashes and avoiding semantic invention.
- Render all Hub strings through `textContent`, never HTML interpretation.

### Bounded secure assets

- Use `no-store`, same-origin resource policy, `Referrer-Policy: no-referrer`, frame and MIME-sniffing protection, and CSP that blocks by default; allows only same-origin script/style/API; and blocks base, forms, and frame ancestors.
- Load fixed static assets at startup up to 256 KiB each. Fail server construction rather than start partially.
- Separate authentication, API client, cursor pager, DOM renderer, and view coordination. Split styles into tokens/connection, workspace, and responsive rules.
- Run `node --check` on browser JavaScript during build.

`/trace` or assets reject query parameters/GET bodies as 400 and other methods as 405. Unknown fixed paths fall through to API 404. UI shows only fixed API messages, never token, stack, or raw failure body; 401 clears view and token.

The shell contains no principal, scope, Hub source, event, or credential. Add no telemetry. Viewing an event proves neither agent understanding/use nor execution/sync state.

HTTP/browser fixtures cover public data-free shell/assets, security headers, no credential echoes, bounded page replacement/backtracking/failure stability, absence of storage APIs/`innerHTML`, and syntax validation.

## Consequences

Users navigate project → run → event only through authorized bounded API pages, and browser state does not grow with complete history. M6 next adds signed remote commands.
