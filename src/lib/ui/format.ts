// Safe display formatters. Every timestamp, duration, and money value the UI
// renders goes through here so a bad or missing value can never leak raw
// ISO strings, "Invalid Date", "NaN", or "undefined" into the page — the
// exact bug class seen on the board Runs page (raw "2026-09-04T13:28:17.958Z"
// mixed with formatted dates).

export const FALLBACK = '—';

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** "Sep 6, 2026, 9:41 AM" — full date+time for tables and activity feeds. */
export function formatDateTime(value: unknown): string {
  const d = parseDate(value);
  if (!d) return FALLBACK;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Sep 6, 2026" — date only, e.g. "last used" labels. */
export function formatDate(value: unknown): string {
  const d = parseDate(value);
  if (!d) return FALLBACK;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "9:41 AM" — time only, for same-day activity rows. */
export function formatTime(value: unknown): string {
  const d = parseDate(value);
  if (!d) return FALLBACK;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "1m 26s" / "40s" / "2h 03m" — compact duration from milliseconds. */
export function formatDurationMs(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return FALLBACK;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${String(remMinutes).padStart(2, '0')}m` : `${hours}h`;
}

/** "$0.0041" — money from a dollar amount; never NaN or "$undefined". */
export function formatCost(dollars: unknown): string {
  if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0) return FALLBACK;
  return `$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
}
