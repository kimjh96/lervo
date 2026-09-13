# Budget privacy and evidence limits

Budget reports contain opaque context event IDs, provider identifiers, environment digests, repository profile classes, cold states, durations, normalized token counts, limits, dispositions, and reason codes. They exclude prompts, outputs, reasoning, document bodies, paths, credentials, native responses, prices, and invoices.

Evidence boundaries:

- An observed counter proves only its declared normalized measurement.
- A stage maximum proves only the exact per-run observations in its matching managed population.
- A p95 result proves only its recorded terminal population.

None proves provider acceptance, model attention, correct learning, task quality, billing, or the next invocation's behavior.
