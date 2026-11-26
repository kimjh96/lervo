/**
 * What the ADE keeps about projects between launches: the selected project, and small copies of
 * project marks by their image's SHA-256, so the switcher shows at once (Lervo ADE projects).
 */
export interface ProjectMemory {
  /** The project selected last, or null. */
  selected(): string | null;
  select(projectId: string): void;
  /** Kept mark images as data URLs, by SHA-256. */
  marks(): Readonly<Record<string, string>>;
  /** Keeps a mark image; the oldest is forgotten beyond the bound. A refused write keeps none. */
  keepMark(sha256: string, url: string): void;
}
