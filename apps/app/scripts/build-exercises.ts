/**
 * Builds the bundled exercise index from the vendor/exercises-dataset submodule (MIT data only).
 * Media (images/videos, © Gym visual) is deliberately excluded — decision 2026-10-01: no exercise media.
 * Run after updating the submodule: pnpm --filter @vitls/app exercises:build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Raw = {
  id: string;
  name: string;
  body_part: string;
  equipment: string;
  target: string;
  secondary_muscles?: string[];
  instruction_steps?: { en?: string[] };
};

const source = fileURLToPath(new URL("../../../vendor/exercises-dataset/data/exercises.json", import.meta.url));
const target = fileURLToPath(new URL("../server/lib/exercises.data.json", import.meta.url));

const exercises = (JSON.parse(readFileSync(source, "utf8")) as Raw[]).map((e) => ({
  id: e.id,
  name: e.name,
  bodyPart: e.body_part,
  equipment: e.equipment,
  target: e.target,
  secondary: e.secondary_muscles ?? [],
  steps: e.instruction_steps?.en ?? [],
}));
writeFileSync(target, JSON.stringify(exercises));
console.log(`Wrote ${exercises.length} exercises to ${target}`);
