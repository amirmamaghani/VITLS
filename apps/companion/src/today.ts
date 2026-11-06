export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function formatSyncAge(iso: string | null, now = new Date()): string {
  if (!iso) return "no data yet";
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  const days = Math.round(min / (24 * 60));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The foreground sync runs when the last successful one is older than this; the background task stays the 15-minute floor. */
const STALE_MINUTES = 10;

export function isStale(lastSyncAt: string | undefined, now = new Date(), minutes = STALE_MINUTES): boolean {
  if (!lastSyncAt) return true;
  return now.getTime() - Date.parse(lastSyncAt) >= minutes * 60_000;
}
