/**
 * Collects streamed text and releases it once per frame, so a fast stream renders at most once
 * per frame without a typing effect (ADE motion, "A reply streams").
 */
export class DeltaBuffer {
  private pending = new Map<string, string>();
  /** When each item's first pending text reached the page, so the pacer counts from then. */
  private arrived = new Map<string, number>();
  private scheduled = false;

  constructor(
    private readonly flush: (
      deltas: ReadonlyMap<string, string>,
      arrived: ReadonlyMap<string, number>,
    ) => void,
    private readonly nextFrame: (run: () => void) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  add(itemId: string, text: string): void {
    this.pending.set(itemId, (this.pending.get(itemId) ?? "") + text);
    if (!this.arrived.has(itemId)) this.arrived.set(itemId, this.now());
    if (this.scheduled) return;
    this.scheduled = true;
    this.nextFrame(() => this.release());
  }

  /** Releases everything now, before a message that must follow the streamed text. */
  release(): void {
    this.scheduled = false;
    if (this.pending.size === 0) return;
    const deltas = this.pending;
    const arrived = this.arrived;
    this.pending = new Map();
    this.arrived = new Map();
    this.flush(deltas, arrived);
  }
}
