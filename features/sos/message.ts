import { SOS_MESSAGE_PREFIX } from '../bluetooth';

export function buildSosHelpText(input: {
  helpMessage: string;
  workspaceLabel?: string;
  lat?: number;
  lon?: number;
  isAuto: boolean;
  startedAt: number;
  deadlineAt: number;
}): string {
  const help =
    (input.helpMessage ?? '').trim() || 'I need help. Please find me.';
  const when = new Date(input.deadlineAt).toLocaleTimeString();
  const mode = input.isAuto
    ? `Missed check-in at ${when} — timer expired`
    : 'Manual SOS — needs help now';
  const workspace = (input.workspaceLabel ?? '').trim();
  let locationLine = '';
  if (
    typeof input.lat === 'number' &&
    typeof input.lon === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lon)
  ) {
    const lat = input.lat.toFixed(5);
    const lon = input.lon.toFixed(5);
    // No inline URL — receivers open location via the Map button, which is
    // built from the structured sos.lat/lon (with legacy URL fallback).
    locationLine = ` Location: ${lat},${lon}`;
  }
  const workPart = workspace ? ` [${workspace}]` : '';
  return `${SOS_MESSAGE_PREFIX}${workPart} — ${mode}. ${help}.${locationLine}`;
}

export function isSosText(message: string): boolean {
  if (!message) return false;
  const t = message.trimStart();
  return t.startsWith(SOS_MESSAGE_PREFIX) || t.startsWith('🆘');
}
