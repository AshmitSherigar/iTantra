export type SosPresetMinutes = 30 | 60 | 180 | 480;

export const SOS_PRESETS: { label: string; minutes: number }[] = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '8h', minutes: 480 },
];

export type SosTimerState = {
  id: string;
  startedAt: number;
  deadlineAt: number;
  durationMs: number;
  helpMessage: string;
  workspaceLabel: string;
  includeLocation: boolean;
  lat?: number;
  lon?: number;
  /** Notification ids so we can cancel warnings on safe-cancel. */
  notificationIds?: string[];
};

export type ReceivedSos = {
  id: string;
  senderName: string;
  message: string;
  language: string;
  receivedAt: number;
  hops: number;
  isAuto: boolean;
  /** Structured coords from envelope.sos (preferred over parsing URLs). */
  lat?: number;
  lon?: number;
};

export function formatRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return '00:00';
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
