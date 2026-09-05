# Event envelope compatibility

The shared reader accepts envelope schema versions 1 and 2, preserving valid mixed hash chains without rewriting bytes or meaning. Version 1 remains the default writer; activated managed execution writes version 2.

A supported but malformed envelope is `event_invalid` at the event-contract boundary and an integrity failure where stored bytes are decoded. An unknown integer envelope version is `event_schema_unsupported`; local storage, sync, and Hub intake reject it before mutation. Invalid hashes and payload allowlists remain integrity failures, not unsupported-version failures.

- [Version 2 payload contracts](event-envelope-compatibility/payload-contracts.md)
- [Validation and evidence boundaries](event-envelope-compatibility/validation-and-evidence.md)
