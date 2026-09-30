# Execution lifecycle

The adapter records one deterministic `managed.execution.reserved` key before calling the provider. An existing execution key requires inspection and prohibits invoking the model again.

Native startup rechecks owner authority, task context, resource sources, and the owner fence. Invocation has a maximum three-minute deadline and observes revocation while active through the incremental authority reader. It is neither an idle model nor a full-history polling loop. Runtime shutdown and authority loss cancel the managed invocation.

## Result projection

Owner reasoning explicitly selects machine JSON result projection. The provider returns one JSON object. Any required evidence comments occupy standalone decoded lines in a string value such as `rationale`.

The common adapter contract parses JSON before checking those strings against the ordinary exact-document reference policy. It rejects malformed JSON (`json_parse_failed`) and known evidence tokens used inline before recording any reference evidence. Unknown or ineligible documents cannot produce receipts.

Valid comments produce deduplicated E4 output-citation receipts and are removed from the published JSON while its structure is retained. Raw result capture and projected artifact hashes remain distinct. Operational events retain neither body nor prompt. Human Markdown results keep their existing projection.
