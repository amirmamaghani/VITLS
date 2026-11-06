/** Bundeslebensmittelschlüssel 4.0 (CC BY 4.0, Max Rubner-Institut) — xlsx. Values per 100 g. */
import type { TabularSpec } from "./tabular";

export const BLS_SPEC: TabularSpec = {
  source: "bls",
  id: "BLS Code",
  name: ["Food name", "Lebensmittelbezeichnung"],
  names: { de: "Lebensmittelbezeichnung" },
  columns: {
    energy: /^ENERCC\b.*kcal/i,
    protein: /^PROT625\b|^Protein/i,
    fat: /^FAT\b|^Fett/i,
    saturated_fat: /^FASAT\b|gesättigte/i,
    carbs: /^CHO\b|^Kohlenhydrate/i,
    sugars: /^SUGAR\b|^Zucker/i,
    fiber: /^FIBT\b|^Ballaststoffe/i,
    sodium: /^NA\b|^Natrium/i,
    potassium: /^K\b|^Kalium/i,
    cholesterol: /^CHORL\b|^Cholesterin/i,
    calcium: /^CA\b|^Calcium/i,
    iron: /^FE\b|^Eisen/i,
    magnesium: /^MG\b|^Magnesium/i,
    vitamin_c: /^VITC\b|^Vitamin C/i,
    vitamin_d: /^VITD\b|^Vitamin D/i,
    alcohol: /^ALC\b|^Alkohol/i,
  },
};
