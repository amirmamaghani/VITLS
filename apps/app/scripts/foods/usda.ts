/**
 * USDA FoodData Central CSV (Foundation + SR Legacy, CC0) → ImportedFood. Amounts are per 100 g.
 * Download from https://fdc.nal.usda.gov/download-datasets the "Foundation Foods" and "SR Legacy" CSV zips — not the
 * Full Download, whose branded data is multi-GB. Merge both into one apps/app/.cache/foods/usda/ folder: concatenate
 * their food.csv, food_nutrient.csv and food_portion.csv (keep one header line each); measure_unit.csv is the same in
 * both, keep one copy.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "csv-parse/sync";
import type { NutrientKey } from "@vitls/health-ingest";

import type { ImportedFood } from "../../server/lib/foods/store";

const USDA_NUTRIENTS: Record<number, NutrientKey> = {
  1008: "energy",
  1003: "protein",
  1004: "fat",
  1258: "saturated_fat",
  1005: "carbs",
  2000: "sugars",
  1079: "fiber",
  1093: "sodium",
  1092: "potassium",
  1253: "cholesterol",
  1087: "calcium",
  1089: "iron",
  1090: "magnesium",
  1162: "vitamin_c",
  1114: "vitamin_d",
  1057: "caffeine",
  1018: "alcohol",
};
/** Atwater energy (kcal) used by Foundation foods that lack 1008. */
const ENERGY_FALLBACKS = [2047, 2048];

const read = (dir: string, file: string) =>
  parse(readFileSync(path.join(dir, file)), { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];

export function parseUsda(dir: string, dataTypes = ["foundation_food", "sr_legacy_food"]): ImportedFood[] {
  const foods = read(dir, "food.csv").filter((f) => dataTypes.includes(f.data_type!));
  const wanted = new Set(foods.map((f) => f.fdc_id));
  const nutrients = new Map<string, Map<number, number>>();
  for (const n of read(dir, "food_nutrient.csv")) {
    if (!wanted.has(n.fdc_id)) continue;
    const amount = Number(n.amount);
    if (!Number.isFinite(amount)) continue;
    const per = nutrients.get(n.fdc_id!) ?? new Map<number, number>();
    per.set(Number(n.nutrient_id), amount);
    nutrients.set(n.fdc_id!, per);
  }
  const units = new Map(read(dir, "measure_unit.csv").map((u) => [u.id, u.name]));
  const portions = new Map<string, { label: string; amount: number }[]>();
  for (const p of read(dir, "food_portion.csv")) {
    if (!wanted.has(p.fdc_id)) continue;
    const grams = Number(p.gram_weight);
    if (!(grams > 0)) continue;
    const unit = units.get(p.measure_unit_id!);
    const unitStr = unit && unit !== "undetermined" ? unit : "";
    const modifier = p.modifier || "";
    // Omit unit name if modifier already starts with it
    const what = [
      unitStr && !modifier.startsWith(unitStr) ? unitStr : "",
      modifier,
      p.portion_description,
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!what) continue;
    const list = portions.get(p.fdc_id!) ?? [];
    list.push({ label: `${Number(p.amount) || 1} ${what}`, amount: grams });
    portions.set(p.fdc_id!, list);
  }
  return foods.map((f) => {
    const per = nutrients.get(f.fdc_id!) ?? new Map<number, number>();
    const mapped: Partial<Record<NutrientKey, number>> = {};
    for (const [id, key] of Object.entries(USDA_NUTRIENTS)) {
      const v = per.get(Number(id));
      if (v !== undefined) mapped[key] = v;
    }
    if (mapped.energy === undefined) {
      const fallback = ENERGY_FALLBACKS.map((id) => per.get(id)).find((v) => v !== undefined);
      if (fallback !== undefined) mapped.energy = fallback;
    }
    return { source: "usda", sourceRef: f.fdc_id!, name: f.description!, basis: "100g", nutrients: mapped, portions: portions.get(f.fdc_id!) ?? [] };
  });
}
