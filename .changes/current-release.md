<!-- lervo-release package="@lervo/cli" version="0.47.1" schema="1" -->

## What's changed

- Reopen the document freshness stage once after a Lervo release, so new freshness behavior such as reverse ADR header lines starts at the release instead of the next repository change or UTC day.
- Write reverse ADR header lines in the header's own list or plain style, with a blank line where the style changes, and let a reverted line return after its revert hold.
