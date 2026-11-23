/** Desktop notifications. */
export interface Notifier {
  notify(title: string, body: string): void;
}
