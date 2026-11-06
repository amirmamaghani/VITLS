/** Session reads for Today, boards and manual log (GET /api/health, /api/coach/profile, /api/meals,
    /api/dashboards). Push stays on the device token. All screen contents are cached (see @/lib/cache):
    shown instantly on every visit, then refreshed on focus / pull-to-refresh. */
import { cacheClearAll, cacheGet, cacheLoad, cacheSet } from "./lib/cache";
import type { WidgetConfig } from "@/components/widgets";
import { apiGet, apiPost } from "./server-client";
import { request, type State } from "./sync";
import { buildMacros, buildToday, type HealthResponse, type Macros, type Readout, type TodayView } from "./today";
import { setAppLocale } from "../modules/app-locale";
import { currentLang, setLangNow, type Lang } from "./lib/i18n";

const isoDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// --- caches (instant first paint; no reload-flash) ---
export const cachedToday = (): TodayView | undefined => cacheGet<TodayView>("today");
export const loadCachedToday = () => cacheLoad<TodayView>("today");
/** Drop all cached contents on sign-out, so the next user never sees the previous one's data. */
export const clearCachedToday = () => cacheClearAll();

type Profile = { readout?: Readout; goals?: { targets?: Record<string, string | number> }[]; localization?: { locale?: string } };

/** Apply the language the coach set (if any) to the OS per-app locale, so the whole app follows it.
    The app ships only en/sk, so anything non-Slovak maps to en. No-op when it already matches. */
export function applyCoachLocale(locale?: string): void {
  if (!locale) return;
  const want: Lang = locale.toLowerCase().startsWith("sk") ? "sk" : "en";
  if (want !== currentLang()) {
    setAppLocale(want); // persist the OS per-app locale (survives restart, shows in system Settings)
    setLangNow(want); // flip the UI now — no activity recreate
  }
}

/** Pull macro targets out of the coach profile's free-form goal targets (keys vary; match loosely). */
function readTargets(p: Profile): { kcal?: number; protein?: number; carbs?: number; fat?: number } | undefined {
  const t = p.goals?.find((g) => g.targets && Object.keys(g.targets).length)?.targets;
  if (!t) return undefined;
  const num = (re: RegExp) => {
    const hit = Object.entries(t).find(([k, v]) => re.test(k) && Number.isFinite(Number(v)));
    return hit ? Number(hit[1]) : undefined;
  };
  return { kcal: num(/kcal|energy|calorie/i), protein: num(/protein/i), carbs: num(/carb/i), fat: num(/fat/i) };
}

export async function getToday(): Promise<TodayView> {
  const to = isoDay();
  const from = isoDay(Date.now() - 2 * 86_400_000); // 3-day window so the newest day with data is included
  const [health, profile, meals] = await Promise.all([
    apiGet<HealthResponse>("/api/health", { from, to, include: "daily,sleep", metrics: "steps,resting_hr" }),
    apiGet<Profile>("/api/coach/profile"),
    apiGet<{ totals: Record<string, number | undefined> }[]>("/api/meals", { from: to, to }).catch(() => []),
  ]);
  applyCoachLocale(profile.localization?.locale);
  const macros: Macros | undefined = meals.length ? buildMacros(meals, readTargets(profile)) : undefined;
  const view = buildToday(health, profile.readout ?? null, to, macros);
  cacheSet("today", view);
  return view;
}

/** A curated tab is just a dashboard (id + title); the nav shows up to 3. */
export type Tab = { id: string; title: string | null };
export const listTabs = () => apiGet<Tab[]>("/api/dashboards");

export interface DashboardRecord {
  id: string;
  title: string | null;
  config: { version: number; widgets: WidgetConfig[] } | null;
  updatedAt: string;
}
const dashKey = (id: string) => `dash:${id}`;
export const cachedDashboard = (id: string) => cacheGet<DashboardRecord>(dashKey(id));
export const loadCachedDashboard = (id: string) => cacheLoad<DashboardRecord>(dashKey(id));
export async function getDashboard(id: string, owner?: string): Promise<DashboardRecord> {
  const d = await apiGet<DashboardRecord>(`/api/dashboards/${id}`, owner ? { owner } : undefined);
  cacheSet(dashKey(id), d);
  return d;
}

/** Latest value per metric (for a board's metric widgets): prefers a point reading (e.g. weight) over daily.
    Values are cached (merged into one map) so boards show numbers instantly, then refresh. */
export const cachedMetrics = (): Record<string, number> => cacheGet<Record<string, number>>("metrics") ?? {};
export const loadCachedMetrics = async (): Promise<Record<string, number>> => (await cacheLoad<Record<string, number>>("metrics")) ?? {};
export async function getLatestMetrics(metrics: string[]): Promise<Record<string, number>> {
  if (!metrics.length) return cachedMetrics();
  const to = isoDay();
  const from = isoDay(Date.now() - 90 * 86_400_000); // daily metrics are capped at 92 days; 90 captures the current value
  type Series<K extends string> = Record<string, { values: ({ value: number } & Record<K, string>)[] }>;
  const h = await apiGet<{ daily?: Series<"date">; points?: Series<"at"> }>("/api/health", { from, to, include: "daily,points", metrics: metrics.join(",") });
  const last = <K extends string>(vals: ({ value: number } & Record<K, string>)[] | undefined, key: K) =>
    vals?.length ? vals.reduce((a, b) => (b[key] >= a[key] ? b : a)).value : undefined;
  const out: Record<string, number> = { ...cachedMetrics() };
  for (const m of metrics) {
    const v = last(h.points?.[m]?.values, "at") ?? last(h.daily?.[m]?.values, "date");
    if (v !== undefined) out[m] = v;
  }
  cacheSet("metrics", out);
  return out;
}

/** Append a widget to a board (the "pin from chat" action and the coach's own save use the same POST). */
export async function pinWidget(dashboardId: string, widget: WidgetConfig): Promise<void> {
  const d = await getDashboard(dashboardId);
  const widgets = [...(d.config?.widgets ?? []), { ...widget, id: widget.id ?? `w-${Date.now()}` }];
  await apiPost(`/api/dashboards/${dashboardId}`, { title: d.title ?? "Dashboard", config: { version: 1, widgets }, expectedUpdatedAt: d.updatedAt });
}

export const registerPush = (state: State, expoToken: string, label?: string) =>
  request<{ ok: true }>(state, "POST", "/api/devices/push", { expoToken, label });
