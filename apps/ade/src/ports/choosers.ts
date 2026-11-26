/** The system's open panel, which the webview cannot show itself (Lervo ADE projects). */
export interface Choosers {
  /** A folder's absolute path, or null when the person cancels. */
  folder(title: string): Promise<string | null>;
  /** A PNG, JPEG, or WebP image's absolute path, or null when the person cancels. */
  image(title: string): Promise<string | null>;
}
