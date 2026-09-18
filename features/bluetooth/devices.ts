export type ScannedDevice = {
  id: string;
  name?: string;
  localName?: string;
  rssi?: number;
  serviceUUIDs?: string[];
  advertisingData?: {
    completeLocalName?: string;
    shortenedLocalName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function getDeviceDisplayName(
  device: ScannedDevice | null | undefined,
): string {
  const candidates = [
    device?.name,
    device?.localName,
    device?.advertisingData?.completeLocalName,
    device?.advertisingData?.shortenedLocalName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (
        trimmed.length > 0 &&
        trimmed.toLowerCase() !== 'unknown' &&
        trimmed.toLowerCase() !== 'null' &&
        trimmed.toLowerCase() !== 'undefined'
      ) {
        return trimmed;
      }
    }
  }
  // No name in the scan record yet (common on the first packet — the name
  // arrives via the scan response a moment later and `mergeScannedDevice`
  // fills it in). Fall back to a short id so the row is still identifiable
  // as a VaaniSetu device instead of a generic "Bluetooth Device".
  const id = typeof device?.id === 'string' ? device.id.trim() : '';
  if (id.length > 0) {
    const shortId = id.length > 8 ? id.slice(-8) : id;
    return `VaaniSetu • ${shortId}`;
  }
  return 'VaaniSetu device';
}

/**
 * True when a scan result advertises our chat service — i.e. it is running
 * this app (VaaniSetu), not a random headphone/speaker/watch.
 *
 * Checks every place the native module can surface service UUIDs:
 * - `serviceUUIDs` (top-level, from ScanRecord.getServiceUuids)
 * - `advertisingData.completeServiceUUIDs128/32/16` (+ incomplete variants)
 */
export function isVaaniSetuDevice(
  device: ScannedDevice | null | undefined,
  serviceUuid: string,
): boolean {
  if (!device) return false;
  const wanted = serviceUuid.trim().toLowerCase();
  if (!wanted) return false;

  const topLevel = Array.isArray(device.serviceUUIDs)
    ? device.serviceUUIDs
    : [];
  for (const uuid of topLevel) {
    if (typeof uuid === 'string' && uuid.trim().toLowerCase() === wanted) {
      return true;
    }
  }

  const adv = device.advertisingData ?? {};
  const buckets = [
    adv.completeServiceUUIDs128,
    adv.incompleteServiceUUIDs128,
    adv.completeServiceUUIDs32,
    adv.incompleteServiceUUIDs32,
    adv.completeServiceUUIDs16,
    adv.incompleteServiceUUIDs16,
  ];
  for (const bucket of buckets) {
    if (Array.isArray(bucket)) {
      for (const uuid of bucket as unknown[]) {
        if (typeof uuid === 'string' && uuid.trim().toLowerCase() === wanted) {
          return true;
        }
      }
    }
  }
  return false;
}

function pickName(prevVal: unknown, nextVal: unknown): string | undefined {
  const prev = typeof prevVal === 'string' ? prevVal.trim() : '';
  const next = typeof nextVal === 'string' ? nextVal.trim() : '';
  return next || prev || undefined;
}

export function mergeScannedDevice(
  prev: ScannedDevice,
  next: ScannedDevice,
): ScannedDevice {
  const merged: ScannedDevice = { ...prev, ...next };
  merged.name = pickName(prev?.name, next?.name);
  merged.localName = pickName(prev?.localName, next?.localName);

  const prevAdv = prev?.advertisingData ?? {};
  const nextAdv = next?.advertisingData ?? {};
  const advertisingData: ScannedDevice['advertisingData'] = {
    ...prevAdv,
    ...nextAdv,
  };
  for (const key of ['completeLocalName', 'shortenedLocalName'] as const) {
    const prevVal =
      typeof prevAdv?.[key] === 'string' ? (prevAdv[key] as string).trim() : '';
    const nextVal =
      typeof nextAdv?.[key] === 'string' ? (nextAdv[key] as string).trim() : '';
    if (nextVal) advertisingData[key] = nextVal;
    else if (prevVal) advertisingData[key] = prevVal;
  }
  merged.advertisingData = advertisingData;

  if (next?.rssi !== undefined) merged.rssi = next.rssi;
  if (next?.serviceUUIDs !== undefined) merged.serviceUUIDs = next.serviceUUIDs;
  return merged;
}
