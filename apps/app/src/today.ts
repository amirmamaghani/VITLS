export type Readout = { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;

export type Macros = { kcal: { eaten: number; goal?: number }; protein: { g: number; goal?: number }; carbs: { g: number; goal?: number }; fat: { g: number; goal?: number } };

export interface TodayView {
  date: string;
  readout: Readout;
  metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
  macros?: Macros;
}

/** Sum today's meal totals into the macro card model; goals (optional) come from the coach profile targets. */
export function buildMacros(meals: { totals: Record<string, number | undefined> }[], goals?: { kcal?: number; protein?: number; carbs?: number; fat?: number }): Macros {
  const sum = (k: string) => Math.round(meals.reduce((t, m) => t + (m.totals[k] ?? 0), 0));
  return {
    kcal: { eaten: sum("energy"), goal: goals?.kcal },
    protein: { g: sum("protein"), goal: goals?.protein },
    carbs: { g: sum("carbs"), goal: goals?.carbs },
    fat: { g: sum("fat"), goal: goals?.fat },
  };
}

/** The slice of GET /api/health this screen reads (session-authed). */
export interface HealthResponse {
  daily?: Record<string, { values: { date: string; value: number }[] }>;
  sleep?: { durationMin: number }[];
}

const latest = (vals?: { date: string; value: number }[]) => (vals?.length ? vals.reduce((a, b) => (b.date >= a.date ? b : a)).value : undefined);

/** Map the health read + coach readout into the Today card model. Sleep rows come ordered by start, so the last is the most recent night. */
export function buildToday(health: HealthResponse, readout: Readout, date: string, macros?: Macros): TodayView {
  return {
    date,
    readout,
    macros,
    metrics: {
      steps: latest(health.daily?.steps?.values),
      resting_hr: latest(health.daily?.resting_hr?.values),
      sleep_min: health.sleep?.length ? health.sleep[health.sleep.length - 1].durationMin : undefined,
    },
  };
}

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
