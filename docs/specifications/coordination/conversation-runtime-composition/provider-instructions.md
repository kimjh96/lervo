# Provider instructions and reply formatting

Instructions include the last four prior turns, each bounded to 2,048 characters, and up to eight durable results, each bounded to 1,024 characters and presented in reverse order. Canonicalization assignments, normalization assignments, and optional context pointers are composed separately.

Instructions require:

- An early checkpoint and reserved finalization time.
- Distinguishing provider-observable checks from host-owned replica and completion gates.
- No claim that pending background knowledge is current.
- External effects limited to explicitly requested effects admitted by requester authority.
- Deployment inspection covering both singular and plural conversation configuration forms.
- Scope stated for counts or absence claims.

The requested final answer is below 1,500 characters in the conversation language. The current `fitDiscord` implementation trims text, replaces em dashes with hyphens, and caps output using Unicode code points at a 1,950-character limit. Oversize output is sliced with a 42-character reserve and receives a fixed Korean truncation notice.

This remains a Discord-specific implementation; these sources do not prove implementation of descriptor-based limits or language-adaptive truncation.
