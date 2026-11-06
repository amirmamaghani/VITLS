import { useSetPageTitle } from "@agent-native/toolkit/app-shell";

import { HealthWidget, type HealthResult, type Session, type WidgetDemo } from "@/components/widgets";
import { MealCard } from "@/components/meals/MealCard";

import type { Widget } from "../../shared/dashboard";
import type { MealView } from "../../shared/meals";

export function meta() {
  return [{ title: "Widgets - VITLS" }];
}

/**
 * UI gallery (dev only, not in navigation): every widget kind and view with fixed demo data, rendered by the same
 * components as /dashboard and chat, so styling changes can be checked in one place. Edits in the meal card hit the
 * real actions and fail on the demo id — that only shows the error state.
 */
export default function WidgetGalleryRoute() {
  useSetPageTitle("Widgets");
  if (!import.meta.env.DEV) return <p className="px-6 py-6 text-sm text-muted-foreground">Only available in development.</p>;
  return (
    <div>
      <div className="flex max-w-6xl flex-col gap-10 px-6 py-6">
        {SECTIONS.map((section) => (
          <section key={section.title} className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{section.items}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Demo data ────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const today = Date.UTC(2026, 9, 7);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Deterministic wavy series ending today: base ± amplitude with a slow drift. */
function series(days: number, base: number, amplitude: number, drift = 0, digits = 1) {
  return Array.from({ length: days }, (_, i) => {
    const value = base + amplitude * Math.sin(i * 0.9) * Math.cos(i * 0.23) + (drift * i) / days;
    return { date: isoDay(today - (days - 1 - i) * DAY), value: Number(value.toFixed(digits)) };
  });
}

function summary(values: { value: number }[], baseline: number) {
  const latest = values[values.length - 1]?.value ?? null;
  return { latest, trend: latest, deviationPct: latest === null ? null : Math.round(((latest - baseline) / baseline) * 1000) / 10 };
}

const daily = (metric: string, values: { date: string; value: number }[], baseline: number, buckets?: { date: string; value: number }[]): WidgetDemo => ({
  health: { daily: { [metric]: { values, buckets, summary: summary(values, baseline) } } },
});

const points = (metric: string, values: { date: string; value: number }[], baseline: number): WidgetDemo => ({
  health: { points: { [metric]: { values: values.map((v) => ({ at: `${v.date}T07:10:00Z`, value: v.value })), summary: summary(values, baseline) } } },
});

const weight = series(30, 87.8, 0.6, -1.2);
const steps = series(14, 9500, 3200, 0, 0);
const weeklySteps = [0, 1, 2, 3, 4, 5].map((w) => ({ date: isoDay(today - (5 - w) * 7 * DAY), value: 62000 + w * 2500 + (w % 2) * 4000 }));

const sleep: HealthResult = {
  sleep: series(7, 7.2, 0.9).map((d) => ({ start: `${d.date}T22:40:00Z`, durationMin: Math.round(d.value * 60) })),
};
const workouts: HealthResult = {
  workouts: [
    { start: `${isoDay(today)}T17:30:00Z`, type: "strength_training", durationMin: 52 },
    { start: `${isoDay(today - DAY)}T06:45:00Z`, type: "running", durationMin: 41, distanceM: 7400 },
    { start: `${isoDay(today - 3 * DAY)}T17:10:00Z`, type: "strength_training", durationMin: 48 },
    { start: `${isoDay(today - 4 * DAY)}T08:00:00Z`, type: "cycling", durationMin: 95, distanceM: 38200 },
  ],
};
const training: Session = {
  title: "Upper body A",
  exercises: [
    { exerciseId: "1", name: "barbell bench press", sets: 4, reps: "6–8", rir: 2, note: "Pause the first rep.", steps: ["Lie on the bench, eyes under the bar.", "Lower to mid-chest.", "Press up and slightly back."] },
    { exerciseId: "2", name: "pull-up", sets: 3, reps: "AMRAP", rir: 1, steps: ["Hang with straight arms.", "Pull until the chin clears the bar."] },
    { exerciseId: "3", name: "dumbbell lateral raise", sets: 3, reps: "12–15", steps: ["Raise to shoulder height.", "Lower slowly."] },
  ],
};
const meal: MealView = {
  id: "demo-meal",
  eatenAt: `${isoDay(today)}T07:30:00Z`,
  localDate: isoDay(today),
  mealType: "breakfast",
  note: null,
  entry: "photo",
  source: "vitls",
  items: [
    { id: "a", foodId: "f1", name: "Quark, half-fat", amount: 250, unit: "g", nutrients: { energy: 302, protein: 31, fat: 12, carbs: 10 }, estimated: false },
    { id: "b", foodId: "f2", name: "Whey protein", amount: 30, unit: "g", nutrients: { energy: 120, protein: 24, fat: 2, carbs: 3 }, estimated: false },
    { id: "c", foodId: null, name: "Blueberries", amount: 80, unit: "g", nutrients: { energy: 46, protein: 0.6, fat: 0.3, carbs: 11 }, estimated: true },
  ],
  totals: { energy: 468, protein: 55.6, fat: 14.3, carbs: 24 },
};

/** A widget without its dashboard id (Omit applied per union member). */
type WidgetSpec = Widget extends infer T ? (T extends Widget ? Omit<T, "id"> : never) : never;

const w = (widget: WidgetSpec, demo: WidgetDemo) => (
  <HealthWidget key={JSON.stringify(widget)} widget={{ id: "demo", ...widget } as Widget} demo={{ today: isoDay(today), ...demo }} />
);

// Coach widgets
const readout = {
  date: isoDay(today),
  directive: "Good recovery: train as planned, keep the first set easy and eat 40 g protein before noon.",
  highlights: [
    { metric: "hrv_rmssd_night", note: "+6 % vs baseline" },
    { metric: "resting_hr", note: "2 bpm below usual" },
    { metric: "protein target", note: "behind by 35 g yesterday" },
  ],
};
const vital = (values: { date: string; value: number }[], recent: number, baseline: number): HealthResult["daily"] => ({
  x: { values, summary: { ...summary(values, baseline), recent, baseline, days: values.length } },
});
const hrv = series(30, 46, 5, 2, 0);
const readinessDemo: HealthResult = {
  daily: {
    hrv_rmssd_night: vital(hrv, 49, 46)!.x!,
    resting_hr: vital(series(30, 54, 2, 0, 0), 53, 54)!.x!,
  },
  sleep: [{ start: `${isoDay(today - DAY)}T22:30:00Z`, end: `${isoDay(today)}T06:20:00Z`, durationMin: 470 }],
};
const weighIns = series(30, 87.8, 0.6, -1.2).filter((_, i) => i % 3 !== 1);
const anomalyDaily = (deviationPct: number, latest: number) => ({ values: [{ date: isoDay(today), value: latest }], summary: { latest, trend: latest, deviationPct } });

// Body, nutrition, recovery
const summaryOf = (values: { value: number }[], extra: object) => ({ ...summary(values, values[0]?.value ?? 1), ...extra });
const tape = (metric: string, base: number, drift: number) => {
  const values = [0, 30, 60, 89].map((back, i) => ({ at: `${isoDay(today - back * DAY)}T07:00:00Z`, value: Number((base - (drift * (3 - i)) / 3).toFixed(3)) })).reverse();
  return [metric, { values, summary: summaryOf(values, {}) }] as const;
};
const circumferences: HealthResult = { points: Object.fromEntries([tape("waist", 0.86, -0.024), tape("shoulders", 1.31, 0.01), tape("chest", 1.04, 0.012), tape("arm", 0.375, 0.008), tape("thigh", 0.6, 0.005)]) };
const intake = series(14, 2150, 350, 0, 0);
const spent = series(14, 2500, 150, 0, 0).map((d) => ({ ...d, value: d.value }));
const dailyOf = (values: { date: string; value: number }[]) => ({ values, summary: summary(values, values[0]!.value) });
const nights = (days: number, deep: number, rem: number) =>
  Array.from({ length: days }, (_, i) => {
    const wake = today - (days - 1 - i) * DAY;
    const wobble = Math.round(25 * Math.sin(i * 1.3));
    return {
      start: `${isoDay(wake - DAY)}T${i % 3 === 0 ? "22" : "21"}:${i % 2 ? "40" : "15"}:00Z`,
      end: `${isoDay(wake)}T0${5 + (i % 3)}:30:00Z`,
      durationMin: 440 + wobble,
      stageMinutes: { deep: deep + wobble / 3, rem: rem + wobble / 2, light: 250 - wobble, awake: 25 + (i % 3) * 5 },
    };
  });
// The band view rolls a 28-day personal normal, so its demo carries the window before the 30 shown days.
const bandMetric = (metric: string, values: { date: string; value: number }[], baseline: number): WidgetDemo => ({
  health: { daily: { [metric]: { values, summary: summary(values, baseline) } } },
});
const mealDemo = (id: string, hour: string, type: MealView["mealType"], name: string, kcal: number, protein: number): MealView => ({
  ...meal, id, mealType: type, eatenAt: `${isoDay(today)}T${hour}:00Z`,
  items: [{ id: `${id}-i`, foodId: null, name, amount: 250, unit: "g", nutrients: { energy: kcal, protein, fat: 10, carbs: 30 }, estimated: true }],
  totals: { energy: kcal, protein, fat: 10, carbs: 30 },
});

// Endurance, strength, activity: twelve weeks of sessions, a few per week.
const zonesOf = (k: number) => [1, 2, 3, 4, 5].map((zone) => ({ zone, seconds: [600, 1500, 700, 300, 100 + k * 20][zone - 1]! }));
const session = (back: number, hour: string, type: string, durationMin: number, extra: object = {}) => ({ start: `${isoDay(today - back * DAY)}T${hour}:00Z`, type, durationMin, ...extra });
// Pace per 100 m: slowly improving (about 2:05 -> 1:49) with session-to-session noise.
const swimMin = (wk: number) => (((125 - wk * 1.5 + [3, -2, 4, -3, 1, -4, 2, -1, 3, -2, 1, -3][wk]!) * (1400 + wk * 50)) / 100) / 60;
const sessions = Array.from({ length: 12 }, (_, wk) => {
  const b = (11 - wk) * 7;
  return [
    session(b + 1, "06:30", "running", 40 + (wk % 4) * 6, { distanceM: 7000 + wk * 250 + (wk % 3) * 600, zones: zonesOf(wk) }),
    session(b + 3, "17:30", "strength_training", 55, {
      sets: [
        ...[0, 1, 2].map(() => ({ exercise: "bench_press", reps: 6, weightKg: 80 + wk * 1.5, muscle: "pectorals" })),
        ...[0, 1, 2, 3].map(() => ({ exercise: "pull_up", reps: 8, weightKg: 10, muscle: "lats" })),
        ...[0, 1].map(() => ({ exercise: "lateral_raise", reps: 12, weightKg: 10, muscle: "delts" })),
        { exercise: "farmer_walk", reps: 1, weightKg: 40 },
      ],
    }),
    session(b + (wk === 11 ? 0 : 4), "07:10", "pool_swimming", swimMin(wk), { distanceM: 1400 + wk * 50, poolLengthM: 25, strokes: 620 - wk * 4 }),
    ...(wk % 2 === 1 ? [session(b + (wk === 11 ? 0 : 5), "09:00", "cycling", 70 + wk * 5, { distanceM: 28000 + wk * 1500 })] : []),
  ];
}).flat();
const ofType = (pattern: RegExp): HealthResult => ({ workouts: sessions.filter((x) => pattern.test(x.type)) });
const profile = { birthYear: 1990, sex: "male" as const };

const SECTIONS = [
  {
    title: "Metric views",
    items: [
      w({ kind: "metric", metric: "weight", view: "number", range: "30d" }, points("weight", weight, 88.4)),
      w({ kind: "metric", metric: "weight", view: "line", range: "30d", title: "Weight trend" }, points("weight", weight, 88.4)),
      w({ kind: "metric", metric: "body_fat_pct", view: "bar", range: "30d" }, points("body_fat_pct", series(10, 21.5, 0.8, -0.6), 22)),
      w({ kind: "metric", metric: "weight", view: "line", range: "90d", title: "Wide widget", wide: true }, points("weight", series(90, 89, 0.9, -3), 89)),
    ],
  },
  {
    title: "More metrics",
    items: [
      w({ kind: "metric", metric: "steps", view: "bar", range: "7d" }, daily("steps", steps, 9000)),
      w({ kind: "metric", metric: "hrv_rmssd_night", view: "line", range: "30d" }, daily("hrv_rmssd_night", series(30, 46, 7, 3, 0), 45)),
      w({ kind: "metric", metric: "resting_hr", view: "line", range: "30d" }, daily("resting_hr", series(30, 54, 3, -2, 0), 55)),
      w({ kind: "metric", metric: "intake_protein", view: "bar", range: "7d", title: "Protein eaten" }, daily("intake_protein", series(7, 160, 25, 0, 0), 175)),
      w({ kind: "metric", metric: "sleep_duration", view: "number", range: "7d" }, daily("sleep_duration", series(7, 26500, 2400, 0, 0), 27000)),
      w({ kind: "metric", metric: "intake_energy", view: "number", range: "7d", title: "Energy eaten today" }, daily("intake_energy", series(7, 2150, 300, 0, 0), 2300)),
      w({ kind: "metric", metric: "steps", view: "bar", range: "90d", bucket: "week", title: "Steps per week" }, daily("steps", [], 9000, weeklySteps)),
    ],
  },
  {
    title: "Rings",
    items: [
      w({ kind: "metric", metric: "training_readiness", view: "ring", range: "7d" }, daily("training_readiness", series(7, 70, 12, 0, 0), 68)),
      w({ kind: "metric", metric: "weight", view: "ring", range: "90d", start: 88, target: 78, title: "Weight goal" }, points("weight", series(30, 84.8, 0.4, -0.8), 86)),
      w({ kind: "metric", metric: "intake_protein", view: "ring", range: "7d", target: 175, title: "Protein today" }, daily("intake_protein", series(7, 142, 0, 0, 0), 160)),
      w({ kind: "metric", metric: "steps", view: "ring", range: "7d", target: 10000, title: "Steps today" }, daily("steps", steps, 9000)),
      w({ kind: "macros" }, {
        health: {
          daily: Object.fromEntries(
            [["intake_energy", 1850], ["intake_protein", 142], ["intake_carbs", 160], ["intake_fat", 62]].map(([k, v]) => [k, { values: [{ date: isoDay(today), value: v as number }], summary: summary([{ value: v as number }], v as number) }]),
          ),
        },
      }),
    ],
  },
  {
    title: "Sleep, workouts, training",
    items: [
      w({ kind: "sleep", view: "duration", range: "7d" }, { health: sleep }),
      w({ kind: "workouts", range: "7d" }, { health: workouts }),
      w({ kind: "training" }, { training }),
    ],
  },
  {
    title: "Coach",
    items: [
      w({ kind: "readout" }, { readout }),
      w({ kind: "readout", title: "Stale readout" }, { readout: { ...readout, date: isoDay(today - DAY) } }),
      w({ kind: "water-vs-fat" }, {
        health: {
          points: {
            weight: {
              values: [{ at: `${isoDay(today - DAY)}T07:10:00Z`, value: 87.4 }, { at: `${isoDay(today)}T07:05:00Z`, value: 89.1 }],
              summary: summary([{ value: 89.1 }], 88),
              lastChange: { deltaKg: 1.7, check: { maxPlausibleFatKg: 0.2, kcalRequired: 13090 } },
            },
          },
        },
      }),
      w({ kind: "metric", metric: "weight", view: "trend", range: "30d" }, points("weight", series(30, 87.8, 1.1, -1.2), 88.4)),
      w({ kind: "readiness" }, { health: readinessDemo }),
      w({ kind: "streak", habit: "weigh-in" }, { health: { points: { weight: { values: weighIns.map((v) => ({ at: `${v.date}T07:10:00Z`, value: v.value })), summary: summary(weighIns, 88) } } } }),
      w({ kind: "streak", habit: "metric", metric: "body_fat_pct", max: 20, title: "Body fat at or below 20 %" }, { health: { points: { body_fat_pct: { values: series(30, 19.6, 0.9, 0.2).map((v) => ({ at: `${v.date}T07:10:00Z`, value: v.value })), summary: summary([{ value: 19.6 }], 20) } } } }),
      w({ kind: "milestone", label: "Smoke-free", since: "2026-03-01" }, {}),
      w({ kind: "anomalies", threshold: 10 }, {
        health: { daily: { resting_hr: anomalyDaily(8, 59), hrv_rmssd_night: anomalyDaily(-14, 39), steps: anomalyDaily(3, 9800) } },
      }),
    ],
  },
  {
    title: "Body & nutrition",
    items: [
      w({ kind: "metric", metric: "weight", view: "rate", range: "30d" }, { health: { points: { weight: { values: weight.map((v) => ({ at: `${v.date}T07:10:00Z`, value: v.value })), summary: { ...summary(weight, 88.4), ratePerWeek: -0.52 } } } } }),
      w({ kind: "metric", metric: "weight", view: "rate", range: "30d", title: "Too fast" }, { health: { points: { weight: { values: weight.map((v) => ({ at: `${v.date}T07:10:00Z`, value: v.value })), summary: { ...summary(weight, 88.4), ratePerWeek: -1.4 } } } } }),
      w({ kind: "metric", metric: "weight", view: "line", compare: "body_fat_pct", range: "30d", title: "Weight vs body fat" }, {
        health: { points: { ...points("weight", weight, 88.4).health!.points, ...points("body_fat_pct", series(30, 21.5, 0.5, -1.2), 22).health!.points } },
      }),
      w({ kind: "circumferences", range: "90d" }, { health: circumferences }),
      w({ kind: "energy-balance", range: "30d" }, { health: { daily: { intake_energy: dailyOf(intake), total_energy: dailyOf(spent) } } }),
      w({ kind: "meals" }, { health: { meals: [mealDemo("m1", "07:30", "breakfast", "Quark with oats", 468, 56), mealDemo("m2", "12:40", "lunch", "Chicken, rice and salad", 720, 52)] } }),
    ],
  },
  {
    title: "Recovery",
    items: [
      w({ kind: "sleep", view: "stages", range: "30d" }, { health: { sleep: nights(14, 75, 95) } }),
      w({ kind: "sleep-schedule", range: "30d" }, { health: { sleep: nights(14, 75, 95) } }),
      w({ kind: "metric", metric: "hrv_rmssd_night", view: "band", range: "30d" }, bandMetric("hrv_rmssd_night", series(58, 46, 7, 8, 0), 46)),
      w({ kind: "metric", metric: "resting_hr", view: "band", range: "30d", title: "Resting HR band" }, bandMetric("resting_hr", series(58, 54, 3, -4, 0), 54)),
    ],
  },
  {
    title: "Endurance & swim",
    items: [
      w({ kind: "volume", sport: "run", range: "90d" }, { health: ofType(/run/) }),
      w({ kind: "volume", sport: "ride", range: "90d" }, { health: ofType(/cycl/) }),
      w({ kind: "volume", sport: "swim", range: "90d" }, { health: ofType(/swim/) }),
      w({ kind: "zones", range: "30d" }, { health: ofType(/run/) }),
      w({ kind: "long-session", sport: "run", range: "90d" }, { health: ofType(/run/) }),
      w({ kind: "swim", range: "90d" }, { health: ofType(/swim/) }),
      w({ kind: "metric", metric: "vo2max", view: "ring", range: "30d" }, { ...daily("vo2max", series(30, 49, 1, 1, 0), 48), profile }),
    ],
  },
  {
    title: "Strength",
    items: [
      w({ kind: "lift", exercise: "bench press", range: "90d" }, { health: ofType(/strength/) }),
      w({ kind: "muscle-volume", range: "30d" }, { health: ofType(/strength/) }),
      w({ kind: "prs", range: "90d" }, { health: ofType(/strength/) }),
    ],
  },
  {
    title: "Activity",
    items: [
      w({ kind: "calendar" }, { health: { workouts: sessions } }),
      w({ kind: "tdee", range: "30d" }, { health: { daily: { total_energy: dailyOf(series(30, 2650, 200, 0, 0)), active_energy: dailyOf(series(30, 640, 150, 0, 0)) } } }),
    ],
  },
  {
    title: "Meal card",
    items: [<MealCard key="meal" meal={meal} />],
  },
  {
    title: "Empty and loading states",
    items: [
      w({ kind: "metric", metric: "vo2max", view: "line", range: "30d" }, { health: {} }),
      w({ kind: "metric", metric: "weight", view: "number", range: "30d", title: "Loading" }, { loading: true }),
      w({ kind: "sleep", view: "duration", range: "7d", title: "Sleep (no data)" }, { health: {} }),
      w({ kind: "training", title: "Training (no plan)" }, { training: null }),
      w({ kind: "readout", title: "Readout (none)" }, { readout: null }),
      w({ kind: "readout", title: "Readout (loading)" }, { loading: true }),
      w({ kind: "water-vs-fat", title: "Water vs fat (no data)" }, { health: {} }),
      w({ kind: "metric", metric: "weight", view: "trend", range: "30d", title: "Trend (no data)" }, { health: {} }),
      w({ kind: "readiness", title: "Readiness (no history)" }, { health: {} }),
      w({ kind: "streak", habit: "workout", title: "Streak (no data)" }, { health: {} }),
      w({ kind: "milestone", label: "Smoke-free", since: "2026-03-01", title: "Milestone (loading)" }, { loading: true }),
      w({ kind: "anomalies", threshold: 10, title: "Anomalies (none)" }, { health: { daily: {} } }),
      w({ kind: "circumferences", range: "90d", title: "Circumferences (none)" }, { health: {} }),
      w({ kind: "energy-balance", range: "30d", title: "Energy balance (no data)" }, { health: {} }),
      w({ kind: "meals", title: "Meals (none)" }, { health: {} }),
      w({ kind: "meals", title: "Meals (loading)" }, { loading: true }),
      w({ kind: "sleep", view: "stages", range: "7d", title: "Sleep stages (no data)" }, { health: {} }),
      w({ kind: "sleep-schedule", range: "30d", title: "Sleep schedule (no data)" }, { health: {} }),
      w({ kind: "metric", metric: "weight", view: "rate", range: "30d", title: "Rate (no data)" }, { health: {} }),
      w({ kind: "metric", metric: "hrv_rmssd_night", view: "band", range: "30d", title: "Band (no history)" }, daily("hrv_rmssd_night", series(5, 46, 3, 0, 0), 46)),
      w({ kind: "metric", metric: "weight", view: "line", compare: "body_fat_pct", range: "30d", title: "Compare (no data)" }, { health: {} }),
      w({ kind: "volume", sport: "run", range: "30d", title: "Volume (no runs)" }, { health: {} }),
      w({ kind: "zones", range: "30d", title: "Zones (no data)" }, { health: ofType(/cycl/) }),
      w({ kind: "long-session", sport: "ride", range: "30d", title: "Longest (no rides)" }, { health: {} }),
      w({ kind: "swim", range: "30d", title: "Swim (none)" }, { health: {} }),
      w({ kind: "lift", exercise: "deadlift", range: "30d" }, { health: ofType(/strength/) }),
      w({ kind: "muscle-volume", range: "30d", title: "Muscle volume (none)" }, { health: {} }),
      w({ kind: "prs", range: "30d", title: "PRs (none)" }, { health: {} }),
      w({ kind: "calendar", title: "Calendar (none)" }, { health: {} }),
      w({ kind: "tdee", range: "30d", title: "Energy (no data)" }, { health: {} }),
      w({ kind: "workouts", range: "7d", title: "Workouts (none)" }, { health: {} }),
      w({ kind: "macros", title: "Macros (nothing logged)" }, { health: {} }),
      w({ kind: "swim", range: "30d", title: "Swim (loading)" }, { loading: true }),
      w({ kind: "metric", metric: "vo2max", view: "ring", range: "30d", title: "VO2max (no profile)" }, daily("vo2max", series(30, 49, 1, 1, 0), 48)),
    ],
  },
];
