# ADR-0040: Read-Only Trace Web View Without Accumulated Pages

- Status: `accepted`
- Decision date: 2026-08-19

## Context

The authenticated API lacked human navigation. Appending every run and event to one screen would recreate long-document problems and grow browser memory with history. A web view must not bypass HTTP authorization or persist bearer credentials in URLs, markup, or browser storage.

## Decision

### Public shell, authenticated data

- `GET /trace` returns a data-free HTML shell. JavaScript and CSS are served only from fixed `/assets/` routes; filesystem paths are never derived from input.
- Shell and asset requests invoke neither the authenticator nor the trace source.
- Keep an entered token only in a page JavaScript variable. Clear the input before requests, and never put the token in a query, fragment, HTML, local or session storage, or cookies.
- Send the token only as Authorization to same-origin `/v1/trace`, without cookie credentials. Clear references on disconnect, 401, and unload. This does not prove removal from browser-process memory or user federation.

### Three independent pagers

- Use separate project, run, and event regions. Runs require a selected project; events require a selected run.
- Display one API cursor page per region and replace its DOM items during navigation. Retain only backward cursor stacks in tab memory; do not accumulate event source.
- The default web page size is 20; the API maximum remains 100.
- Changing the project page clears run and event selection. Changing the run page clears event selection. Ignore late responses that do not match the current pager. A failed next-page request preserves the current position.
- Label `continuous` as “Continuous history” and `buffered` as “Awaiting predecessor,” using text and color. Provide human descriptions for known event fields while preserving IDs and hashes and avoiding invented semantics.
- Render every Hub string through `textContent`, never HTML interpretation.

### Bounded secure assets

- Use `no-store`, same-origin resource policy, `Referrer-Policy: no-referrer`, frame protection, MIME-sniffing protection, and a CSP that blocks by default, permits only same-origin script, style, and API access, and blocks bases, forms, and frame ancestors.
- At startup, load fixed static assets limited to 256 KiB each. Fail server construction instead of starting partially.
- Keep authentication, API client, cursor pager, DOM renderer, and view coordination separate. Split styles into token and connection, workspace, and responsive rules.
- Run `node --check` on browser JavaScript during the build.

`/trace` and asset routes reject query parameters or GET bodies with 400 and other methods with 405. Unknown fixed paths fall through to API 404. The UI shows only fixed API messages, never tokens, stacks, or raw failure bodies; a 401 clears the view and token.

The shell contains no principal, scope, Hub source, event, or credential. It adds no telemetry. Viewing an event proves neither agent understanding or use nor execution or synchronization state.

HTTP and browser fixtures cover a public data-free shell and assets, security headers, absence of credential echoes, bounded page replacement, backtracking and failure stability, absence of storage APIs and `innerHTML`, and syntax validation.

## Consequences

Users navigate project → run → event only through authorized, bounded API pages, and browser state does not grow with complete history. M6 next adds signed remote commands.
