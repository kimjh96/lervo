/** The `Stop` answer: `{}`, or a block with its reason, which the provider gives the model. */
export function stopAnswer(blockReason: string | null): string {
  return blockReason === null
    ? "{}\n"
    : `${JSON.stringify({ decision: "block", reason: blockReason })}\n`;
}
