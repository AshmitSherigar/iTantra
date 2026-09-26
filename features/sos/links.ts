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
    /maps\.google\.|google\.com\/maps|goo\.gl\/maps|openstreetmap\.org|geo:/i.test(
      u,
    ),
  );
  return maps ?? urls[0];
}

/** Build a maps link from structured coordinates. */
export function buildMapUrl(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const la = lat.toFixed(5);
  const lo = lon.toFixed(5);
  return `https://maps.google.com/?q=${la},${lo}`;
}

/**
 * Preferred map URL for an SOS: structured lat/lon first (new senders carry
 * no inline URL), legacy inline URL fallback for old senders.
 */
export function resolveSosMapUrl(
  message: string,
  lat?: number,
  lon?: number,
): string | null {
  if (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return buildMapUrl(lat, lon);
  }
  return extractMapUrl(message);
}

/** Display text for an SOS: strip any inline URLs, Map button covers it. */
export function stripUrlsForDisplay(message: string): string {
  if (!message) return '';
  return message
    .replace(URL_RE, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
