/** Read-only access to the bundled exercise index (see scripts/build-exercises.ts). */
import data from "./exercises.data.json";

export interface Exercise {
  id: string;
  name: string;
  bodyPart: string;
  equipment: string;
  target: string;
  secondary: string[];
  steps: string[];
}

const exercises = data as Exercise[];
const byId = new Map(exercises.map((e) => [e.id, e]));

export const getExercise = (id: string) => byId.get(id);

/** Case-insensitive search over name/target/body part/equipment; every query word must match. */
export function searchExercises(filter: { query?: string; bodyPart?: string; equipment?: string; target?: string; limit?: number }) {
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const eq = (a: string, b?: string) => !b || a.toLowerCase() === b.toLowerCase();
  return exercises
    .filter((e) => eq(e.bodyPart, filter.bodyPart) && eq(e.equipment, filter.equipment) && eq(e.target, filter.target))
    .filter((e) => {
      const haystack = `${e.name} ${e.target} ${e.bodyPart} ${e.equipment} ${e.secondary.join(" ")}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    })
    .slice(0, filter.limit ?? 20)
    .map(({ steps: _steps, ...summary }) => summary);
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const library = exercises.map((e) => ({ key: squash(e.name), target: e.target })).sort((a, b) => a.key.length - b.key.length);
const muscles = new Map<string, string | undefined>();

/** Best-effort primary muscle of a logged exercise: the shortest library name containing it (case and separators ignored). */
export function muscleOf(exercise: string): string | undefined {
  const key = squash(exercise);
  if (!key) return undefined;
  if (!muscles.has(key)) muscles.set(key, library.find((e) => e.key.includes(key))?.target);
  return muscles.get(key);
}
