// Whether a document can link to a split document by its file name. Links may spell the name
// percent-encoded, as GitHub and most editors write a name with spaces or non-ASCII letters, so
// the encoded forms count too; a pre-filter that missed them would leave such links unchecked.

/** True when `text` holds `name` plainly or percent-encoded, in either hex case. */
export function mentionsFileName(text: string, name: string): boolean {
  if (text.includes(name)) return true;
  const encoded = [encodeURI(name), encodeURIComponent(name)].filter((form) => form !== name);
  if (encoded.length === 0) return false;
  const lower = text.toLowerCase();
  return encoded.some((form) => text.includes(form) || lower.includes(form.toLowerCase()));
}
