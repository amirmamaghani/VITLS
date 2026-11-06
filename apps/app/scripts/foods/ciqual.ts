/** ANSES CIQUAL 2025 (Etalab Open License 2.0) — https://ciqual.anses.fr, xlsx "Table Ciqual 2025". Values per 100 g. */
import type { TabularSpec } from "./tabular";

export const CIQUAL_SPEC: TabularSpec = {
  source: "ciqual",
  id: "alim_code",
  // The 2025 xlsx has French names only; alim_nom_eng is kept for older/XML-derived tables.
  name: ["alim_nom_eng", "alim_nom_fr"],
  names: { fr: "alim_nom_fr" },
  columns: {
    energy: /^Energie, Règlement UE N° 1169[ /]*2011 \(kcal[ /]*100 ?g\)/i,
    protein: /^Protéines, N x facteur de Jones \(g[ /]*100 ?g\)/i,
    fat: /^Lipides \(g[ /]*100 ?g\)/i,
    saturated_fat: /^AG saturés \(g[ /]*100 ?g\)/i,
    carbs: /^Glucides \(g[ /]*100 ?g\)/i,
    sugars: /^Sucres \(g[ /]*100 ?g\)/i,
    fiber: /^Fibres alimentaires \(g[ /]*100 ?g\)/i,
    sodium: /^Sodium \(mg[ /]*100 ?g\)/i,
    potassium: /^Potassium \(mg[ /]*100 ?g\)/i,
    cholesterol: /^Cholestérol \(mg[ /]*100 ?g\)/i,
    calcium: /^Calcium \(mg[ /]*100 ?g\)/i,
    iron: /^Fer \(mg[ /]*100 ?g\)/i,
    magnesium: /^Magnésium \(mg[ /]*100 ?g\)/i,
    vitamin_c: /^Vitamine C \(mg[ /]*100 ?g\)/i,
    vitamin_d: /^Vitamine D \(µg[ /]*100 ?g\)/i,
    alcohol: /^Alcool \(éthanol\) \(g[ /]*100 ?g\)/i,
  },
};
