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
  return 'Bluetooth Device';
}

function pickName(prevVal: unknown, nextVal: unknown): string | undefined {
  const prev = typeof prevVal === 'string' ? prevVal.trim() : '';
  const next = typeof nextVal === 'string' ? nextVal.trim() : '';
  return next || prev || undefined;
}

/**
 * Merge a repeat sighting of the same peripheral.
 * allowDuplicates delivers the same id again, often with the local name
 * filled in only on the second callback — merge instead of dropping.
 */
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
