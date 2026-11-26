/**
 * The most bytes Lervo reads from one context source, an instruction or evidence document. A
 * larger source is refused rather than cut, and a prepared context counts at most this much for
 * each source it holds.
 */
export const MAX_CONTEXT_SOURCE_BYTES = 128 * 1024;
