const URL_RE = /(https?:\/\/[^\s)]+|geo:[^\s)]+)/g;

/** All http(s)/geo URLs inside a broadcast message. */
export function extractUrls(message: string): string[] {
  if (!message) return [];
  const found = message.match(URL_RE);
  if (!found) return [];
  // Strip trailing punctuation the message formatter may have added.
  return [...new Set(found.map((u) => u.replace(/[.,;!?]+$/, '')))];
}

/** First Google-maps / geo link in the message, if any. */
export function extractMapUrl(message: string): string | null {
  const urls = extractUrls(message);
  if (urls.length === 0) return null;
  const maps = urls.find((u) =>
    /maps\.google\.|google\.com\/maps|goo\.gl\/maps|openstreetmap\.org|geo:/i.test(u),
  );
  return maps ?? urls[0];
}
