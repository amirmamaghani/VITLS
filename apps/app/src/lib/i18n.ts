/** Tiny no-framework i18n for the app chrome (static UI strings only — server/coach content is already
    localized by the coach). A flat dict + a reactive `useT()` hook (module store, like appearance.ts for
    the theme). The language follows the OS per-app locale (Android 13+ / iOS per-app language); EN is the
    fallback. The user changes it in system settings; the coach changes it via the native AppLocale module. */
import * as Localization from "expo-localization";
import { AppState } from "react-native";
import { useSyncExternalStore } from "react";
import { getAppLocale } from "../../modules/app-locale";

export type Lang = "en" | "sk";

// The applied per-app locale: the native override (set by the coach or the system Settings screen, read
// back immediately) if any, else the device locale. Guarded — a transient native-module hiccup must never
// crash the whole app (this module is imported by the root layout); fall back to EN.
const osLang = (): Lang => {
  try {
    const code = getAppLocale() || Localization.getLocales()[0]?.languageCode || "en";
    return code.toLowerCase().startsWith("sk") ? "sk" : "en";
  } catch {
    return "en";
  }
};

let current: Lang = osLang();
const subs = new Set<() => void>();
/** Re-read the applied locale and notify subscribers if it changed. Call after the coach sets the locale,
    and on foreground (the system Settings change recreates the app, but this covers any missed case). */
export const syncLang = (): void => {
  const next = osLang();
  if (next === current) return;
  current = next;
  subs.forEach((f) => f());
};

/** Set the active language to a known value now (the coach path knows its target; avoids depending on the
    native locale being read back synchronously). The native override is persisted separately by setAppLocale. */
export const setLangNow = (l: Lang): void => {
  if (l === current) return;
  current = l;
  subs.forEach((f) => f());
};

AppState.addEventListener("change", (s) => s === "active" && syncLang());

/** Re-read the OS locale on launch (call before the first render gate releases). */
export async function loadLang(): Promise<void> {
  syncLang();
}
export const currentLang = (): Lang => current;

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
/** The active language, reactive — a component reading it re-renders when the user switches. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, currentLang, currentLang);

export type TFunc = (key: string, vars?: Record<string, string | number>) => string;
/** Translate a key; `{name}` placeholders are filled from `vars`. Missing keys fall back to EN, then the key. */
export function useT(): TFunc {
  const lang = useLang();
  return (key, vars) => {
    let str = DICT[lang][key] ?? DICT.en[key] ?? key;
    if (vars) for (const k in vars) str = str.replace(`{${k}}`, String(vars[k]));
    return str;
  };
}

export const langLabel = (l: Lang): string => (l === "sk" ? "Slovenčina" : "English");

const DICT: Record<Lang, Record<string, string>> = {
  en: {
    "nav.today": "Today",
    "nav.board": "Board",
    "nav.askCoach": "Ask coach",
    "a11y.back": "Back",
    "a11y.account": "Account and settings",
    "a11y.openChat": "Open chat",
    "today.compact": "Today",
    "today.signedOutIntro": "VITLS reads your health data from this phone and shows your coach's plan for today.",
    "today.signIn": "Sign in",
    "today.disclaimer": "VITLS is a coach, not a doctor. Nothing here is medical advice.",
    "stat.steps": "Steps",
    "stat.restingHr": "Resting HR",
    "card.sleep": "Sleep",
    "greeting.morning": "Good morning",
    "greeting.afternoon": "Good afternoon",
    "greeting.evening": "Good evening",
    "board.subtitle": "Assembled by your coach from your health data",
    "board.empty": "This board is empty. Ask the coach to add widgets.",
    "board.change": "Ask coach to change this",
    "board.changePrefill": 'Change my "{title}" board: ',
    "settings.title": "Settings",
    "settings.account": "Your account",
    "settings.signedInOn": "Signed in on this phone",
    "settings.sec.coaching": "COACHING",
    "settings.sec.devices": "DEVICES & DATA",
    "settings.sec.sharing": "SHARING",
    "settings.sec.prefs": "PREFERENCES",
    "settings.coachingStyle": "Coaching style",
    "settings.coachingStyleVal": "Longevity mentor",
    "settings.goals": "Your goals",
    "settings.coachingLang": "Coaching language",
    "settings.language": "Language",
    "settings.phoneSync": "Phone sync",
    "settings.syncing": "Syncing…",
    "settings.connectedSync": "Connected · Sync now",
    "settings.connect": "Connect",
    "settings.synced": "Synced.",
    "settings.yourData": "Your data",
    "settings.doctorAccess": "Doctor access",
    "settings.off": "Off",
    "settings.notifications": "Notifications",
    "settings.appearance": "Appearance",
    "settings.privacy": "Privacy",
    "settings.privacyVal": "Data stays in the EU",
    "settings.signOut": "Sign out",
    "settings.footer": "VITLS — coaching, not medical advice",
    "settings.prefill.coachingStyle": "Change my coaching style",
    "settings.prefill.goals": "Change my goals",
    "settings.prefill.language": "Change the language you coach me in",
    "settings.prefill.data": "Show me my health data",
    "settings.prefill.doctor": "Give my doctor read-only access",
    "settings.prefill.reminders": "Change my reminders",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "chat.yourChats": "YOUR CHATS",
    "chat.newChat": "New chat",
    "chat.noChats": "No saved chats yet.",
    "chat.messagePlaceholder": "Message your coach…",
    "chat.loading": "Loading…",
    "chat.orType": "…or type your own answer below.",
    "chat.addTabPrefill": "Add a tab for ",
    "widget.noReadout": "No readout yet. Your coach writes one every morning.",
    "widget.coachToday": "YOUR COACH · TODAY",
    "widget.updated": "Updated {at}",
    "widget.nutrition": "Nutrition",
    "widget.kcalLeft": "kcal left",
    "widget.kcal": "kcal",
    "widget.eatenGoal": "{eaten} eaten · {goal} goal",
    "macro.protein": "Protein",
    "macro.carbs": "Carbs",
    "macro.fat": "Fat",
    "widget.thisWeek": "This week",
    "widget.weekdays": "M,T,W,T,F,S,S",
    "widget.sessionsOf": "{done} of {total} sessions",
    "widget.todaysSession": "Today's session",
    "widget.noSession": "No session planned today.",
    "widget.readiness": "Readiness",
    "widget.ready": "READY",
    "widget.needsReadiness": "Needs HRV, resting HR and sleep.",
    "widget.todaysMeals": "TODAY'S MEALS",
    "widget.mealPlan": "{n}-meal plan",
    "widget.planned": "planned",
    "widget.liveDataComing": "live data coming",
    "metric.weight": "Weight",
    "metric.resting_hr": "Resting HR",
    "metric.steps": "Steps",
    "metric.sleep_duration": "Sleep",
    "metric.sleep_score": "Sleep score",
    "metric.vo2max": "VO₂max",
    "metric.hrv_rmssd_night": "HRV",
    "metric.hrv_sdnn_night": "HRV (SDNN)",
    "metric.body_fat_pct": "Body fat",
    "metric.muscle_mass": "Muscle mass",
    "metric.lean_mass": "Lean mass",
    "metric.active_energy": "Active energy",
    "metric.total_energy": "Total energy",
    "metric.distance": "Distance",
    "metric.intensity_minutes": "Intensity",
    "metric.training_readiness": "Readiness",
    "metric.fallback": "Metric",
  },
  sk: {
    "nav.today": "Dnes",
    "nav.board": "Prehľad",
    "nav.askCoach": "Spýtaj sa kouča",
    "a11y.back": "Späť",
    "a11y.account": "Účet a nastavenia",
    "a11y.openChat": "Otvoriť chat",
    "today.compact": "Dnes",
    "today.signedOutIntro": "VITLS číta tvoje zdravotné dáta z tohto telefónu a ukáže plán od kouča na dnes.",
    "today.signIn": "Prihlásiť sa",
    "today.disclaimer": "VITLS je kouč, nie lekár. Nič tu nie je lekárska rada.",
    "stat.steps": "Kroky",
    "stat.restingHr": "Pokojová TF",
    "card.sleep": "Spánok",
    "greeting.morning": "Dobré ráno",
    "greeting.afternoon": "Dobré popoludnie",
    "greeting.evening": "Dobrý večer",
    "board.subtitle": "Zostavené koučom z tvojich zdravotných dát",
    "board.empty": "Tento prehľad je prázdny. Požiadaj kouča o pridanie widgetov.",
    "board.change": "Požiadaj kouča o zmenu",
    "board.changePrefill": 'Zmeň môj prehľad „{title}“: ',
    "settings.title": "Nastavenia",
    "settings.account": "Tvoj účet",
    "settings.signedInOn": "Prihlásený na tomto telefóne",
    "settings.sec.coaching": "KOUČING",
    "settings.sec.devices": "ZARIADENIA A DÁTA",
    "settings.sec.sharing": "ZDIEĽANIE",
    "settings.sec.prefs": "PREDVOĽBY",
    "settings.coachingStyle": "Štýl koučingu",
    "settings.coachingStyleVal": "Mentor dlhovekosti",
    "settings.goals": "Tvoje ciele",
    "settings.coachingLang": "Jazyk kouča",
    "settings.language": "Jazyk",
    "settings.phoneSync": "Synchronizácia telefónu",
    "settings.syncing": "Synchronizujem…",
    "settings.connectedSync": "Pripojené · Synchronizovať",
    "settings.connect": "Pripojiť",
    "settings.synced": "Zosynchronizované.",
    "settings.yourData": "Tvoje dáta",
    "settings.doctorAccess": "Prístup pre lekára",
    "settings.off": "Vypnuté",
    "settings.notifications": "Upozornenia",
    "settings.appearance": "Vzhľad",
    "settings.privacy": "Súkromie",
    "settings.privacyVal": "Dáta zostávajú v EÚ",
    "settings.signOut": "Odhlásiť sa",
    "settings.footer": "VITLS — koučing, nie lekárska rada",
    "settings.prefill.coachingStyle": "Zmeň môj štýl koučingu",
    "settings.prefill.goals": "Zmeň moje ciele",
    "settings.prefill.language": "Zmeň jazyk, v ktorom ma koučuješ",
    "settings.prefill.data": "Ukáž mi moje zdravotné dáta",
    "settings.prefill.doctor": "Daj môjmu lekárovi prístup na čítanie",
    "settings.prefill.reminders": "Zmeň moje pripomienky",
    "theme.light": "Svetlý",
    "theme.dark": "Tmavý",
    "chat.yourChats": "TVOJE CHATY",
    "chat.newChat": "Nový chat",
    "chat.noChats": "Zatiaľ žiadne uložené chaty.",
    "chat.messagePlaceholder": "Napíš koučovi…",
    "chat.loading": "Načítavam…",
    "chat.orType": "…alebo napíš vlastnú odpoveď nižšie.",
    "chat.addTabPrefill": "Pridaj záložku pre ",
    "widget.noReadout": "Zatiaľ žiadny súhrn. Kouč ho píše každé ráno.",
    "widget.coachToday": "TVOJ KOUČ · DNES",
    "widget.updated": "Aktualizované {at}",
    "widget.nutrition": "Výživa",
    "widget.kcalLeft": "kcal zostáva",
    "widget.kcal": "kcal",
    "widget.eatenGoal": "{eaten} zjedené · cieľ {goal}",
    "macro.protein": "Bielkoviny",
    "macro.carbs": "Sacharidy",
    "macro.fat": "Tuky",
    "widget.thisWeek": "Tento týždeň",
    "widget.weekdays": "Po,Ut,St,Št,Pi,So,Ne",
    "widget.sessionsOf": "{done} z {total} tréningov",
    "widget.todaysSession": "Dnešný tréning",
    "widget.noSession": "Dnes nie je naplánovaný tréning.",
    "widget.readiness": "Pripravenosť",
    "widget.ready": "FORMA",
    "widget.needsReadiness": "Potrebuje HRV, pokojovú TF a spánok.",
    "widget.todaysMeals": "DNEŠNÉ JEDLÁ",
    "widget.mealPlan": "{n} jedál denne",
    "widget.planned": "plánované",
    "widget.liveDataComing": "dáta čoskoro",
    "metric.weight": "Váha",
    "metric.resting_hr": "Pokojová TF",
    "metric.steps": "Kroky",
    "metric.sleep_duration": "Spánok",
    "metric.sleep_score": "Skóre spánku",
    "metric.vo2max": "VO₂max",
    "metric.hrv_rmssd_night": "HRV",
    "metric.hrv_sdnn_night": "HRV (SDNN)",
    "metric.body_fat_pct": "Telesný tuk",
    "metric.muscle_mass": "Svalová hmota",
    "metric.lean_mass": "Čistá hmota",
    "metric.active_energy": "Aktívna energia",
    "metric.total_energy": "Celková energia",
    "metric.distance": "Vzdialenosť",
    "metric.intensity_minutes": "Intenzita",
    "metric.training_readiness": "Pripravenosť",
    "metric.fallback": "Metrika",
  },
};

if (__DEV__) {
  // Catch drift early: a key present in one language but not the other would silently fall back to EN.
  const en = Object.keys(DICT.en).sort();
  const sk = Object.keys(DICT.sk).sort();
  const missing = [...en.filter((k) => !(k in DICT.sk)).map((k) => `sk:${k}`), ...sk.filter((k) => !(k in DICT.en)).map((k) => `en:${k}`)];
  if (missing.length) console.warn(`[i18n] key parity mismatch: ${missing.join(", ")}`);
}
