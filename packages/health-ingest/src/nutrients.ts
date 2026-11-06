/**
 * Nutrient catalog: the nutrients VITLS tracks, in canonical units per 100 g/ml of food and per day of intake.
 * Each maps 1:1 to Apple HealthKit (HKQuantityTypeIdentifierDietary…) and Health Connect (NutritionRecord field),
 * so meals can be imported from and exported to both. Adding a nutrient is one entry (docs/design/06-nutrition.md §3).
 * Note: alcohol is the documented exception with no HealthKit or Health Connect type.
 */
export type NutrientUnit = "kcal" | "g" | "mg" | "ug" | "ml";

export interface NutrientDefinition {
  key: string;
  unit: NutrientUnit;
  label: string;
  /** HKQuantityTypeIdentifier…; null when HealthKit has no dietary type for it. */
  healthKit: string | null;
  /** Health Connect NutritionRecord field (water: HydrationRecord.volume). */
  healthConnect: string | null;
}

const n = <K extends string>(
  key: K,
  unit: NutrientUnit,
  label: string,
  hk: string | null,
  hc: string | null,
): NutrientDefinition & { key: K } => ({
  key,
  unit,
  label,
  healthKit: hk ? `HKQuantityTypeIdentifierDietary${hk}` : null,
  healthConnect: hc,
});

export const NUTRIENTS = [
  n("energy", "kcal", "Energy", "EnergyConsumed", "energy"),
  n("protein", "g", "Protein", "Protein", "protein"),
  n("fat", "g", "Fat", "FatTotal", "totalFat"),
  n("saturated_fat", "g", "Saturated fat", "FatSaturated", "saturatedFat"),
  n("carbs", "g", "Carbohydrates", "Carbohydrates", "totalCarbohydrate"),
  n("sugars", "g", "Sugars", "Sugar", "sugar"),
  n("fiber", "g", "Fiber", "Fiber", "dietaryFiber"),
  n("sodium", "mg", "Sodium", "Sodium", "sodium"),
  n("potassium", "mg", "Potassium", "Potassium", "potassium"),
  n("cholesterol", "mg", "Cholesterol", "Cholesterol", "cholesterol"),
  n("calcium", "mg", "Calcium", "Calcium", "calcium"),
  n("iron", "mg", "Iron", "Iron", "iron"),
  n("magnesium", "mg", "Magnesium", "Magnesium", "magnesium"),
  n("vitamin_c", "mg", "Vitamin C", "VitaminC", "vitaminC"),
  n("vitamin_d", "ug", "Vitamin D", "VitaminD", "vitaminD"),
  n("caffeine", "mg", "Caffeine", "Caffeine", "caffeine"),
  n("water", "ml", "Water", "Water", "volume"),
  n("alcohol", "g", "Alcohol", null, null),
] as const satisfies readonly NutrientDefinition[];

export type NutrientKey = (typeof NUTRIENTS)[number]["key"];

const byKey = new Map<string, NutrientDefinition>(NUTRIENTS.map((x) => [x.key, x]));

export const getNutrient = (key: string): NutrientDefinition | undefined => byKey.get(key);
export const isNutrientKey = (key: string): key is NutrientKey => byKey.has(key);
export const intakeMetric = (key: NutrientKey | string): string => `intake_${key}`;
