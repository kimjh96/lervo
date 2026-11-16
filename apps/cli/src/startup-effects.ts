/**
 * Set to `skip` only by the host upgrade health probe (ADR-0571): a candidate CLI must not
 * publish its terminal-hook runtime before the gate decides to keep it.
 */
export const STARTUP_EFFECTS_VARIABLE = "LERVO_STARTUP_EFFECTS";
