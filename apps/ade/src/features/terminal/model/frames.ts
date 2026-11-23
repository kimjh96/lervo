/** Bytes written to the terminal per frame at most, so a flood never blocks input. */
export const FRAME_BYTES = 64 * 1024;

/**
 * Collects terminal output and writes it at most once per frame, up to `budget` bytes, carrying
 * the rest to the next frame (ADE performance, "GPU and rendering"). Nothing is scheduled while
 * no output waits.
 */
export class FrameBoundWriter {
  private queue: Uint8Array[] = [];
  private queued = 0;
  private scheduled = false;

  constructor(
    private readonly write: (bytes: Uint8Array) => void,
    private readonly nextFrame: (run: () => void) => void,
    private readonly budget = FRAME_BYTES,
  ) {}

  add(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) return;
    this.queue.push(bytes);
    this.queued += bytes.byteLength;
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    this.nextFrame(() => this.flush());
  }

  private flush(): void {
    this.scheduled = false;
    const size = Math.min(this.budget, this.queued);
    const chunk = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      const head = this.queue[0];
      if (head === undefined) break;
      const take = Math.min(head.byteLength, size - filled);
      chunk.set(head.subarray(0, take), filled);
      filled += take;
      if (take === head.byteLength) this.queue.shift();
      else this.queue[0] = head.subarray(take);
    }
    this.queued -= filled;
    this.write(chunk);
    if (this.queued > 0) this.schedule();
  }
}
