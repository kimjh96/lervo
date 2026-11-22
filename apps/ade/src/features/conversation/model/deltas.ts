/**
 * Collects streamed text and releases it once per frame, so a fast stream renders at most once
 * per frame without a typing effect (ADE motion, "A reply streams").
 */
export class DeltaBuffer {
  private pending = new Map<string, string>();
  private scheduled = false;

  constructor(
    private readonly flush: (deltas: ReadonlyMap<string, string>) => void,
    private readonly nextFrame: (run: () => void) => void,
  ) {}

  add(itemId: string, text: string): void {
    this.pending.set(itemId, (this.pending.get(itemId) ?? "") + text);
    if (this.scheduled) return;
    this.scheduled = true;
    this.nextFrame(() => this.release());
  }

  /** Releases everything now, before a message that must follow the streamed text. */
  release(): void {
    this.scheduled = false;
    if (this.pending.size === 0) return;
    const deltas = this.pending;
    this.pending = new Map();
    this.flush(deltas);
  }
}
