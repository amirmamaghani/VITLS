import { describe, expect, it } from "vitest";

import { BLS_SPEC } from "./bls";
import { CIQUAL_SPEC } from "./ciqual";
import { parseTabular, toNumber } from "./tabular";

describe("tabular food tables", () => {
  it("parses French decimals, traces and bounds", () => {
    expect(toNumber("12,5")).toBe(12.5);
    expect(toNumber("traces")).toBe(0);
    expect(toNumber("< 0,5")).toBe(0.25);
    expect(toNumber("-")).toBeUndefined();
    expect(toNumber(7)).toBe(7);
  });

  it("maps CIQUAL columns by header", () => {
    const rows = [
      {
        alim_code: "22000",
        alim_nom_fr: "Œuf, cru",
        alim_nom_eng: "Egg, raw",
        "Energie, Règlement UE N° 1169/2011 (kcal/100 g)": "140",
        "Protéines, N x facteur de Jones (g/100 g)": "12,7",
        "Glucides (g/100 g)": "0,27",
        "Lipides (g/100 g)": "9,83",
        "Sodium (mg/100 g)": "130",
        "Eau (g/100 g)": "76",
      },
    ];
    const [egg] = parseTabular(rows, CIQUAL_SPEC);
    expect(egg).toMatchObject({ source: "ciqual", sourceRef: "22000", name: "Egg, raw", names: { fr: "Œuf, cru" }, basis: "100g" });
    expect(egg!.nutrients).toEqual({ energy: 140, protein: 12.7, carbs: 0.27, fat: 9.83, sodium: 130 });
  });

  it("maps the real CIQUAL 2025 xlsx headers (newlines collapsed by readXlsx, French names only)", () => {
    const rows = [
      {
        alim_code: "22000",
        alim_nom_fr: "Œuf, cru",
        "Energie, Règlement UE N° 1169 2011 (kcal 100 g)": "140",
        "Protéines, N x facteur de Jones (g 100 g)": "12,7",
        "Glucides (g 100 g)": "0,27",
        "Lipides (g 100 g)": "9,83",
        "Fibres alimentaires (g 100 g)": "-",
        "Alcool (éthanol) (g 100 g)": "traces",
        "Vitamine D (µg 100 g)": "< 0,5",
        "Fer (mg 100 g)": "1,8",
      },
    ];
    const [egg] = parseTabular(rows, CIQUAL_SPEC);
    expect(egg).toMatchObject({ name: "Œuf, cru", names: { fr: "Œuf, cru" } });
    expect(egg!.nutrients).toEqual({ energy: 140, protein: 12.7, carbs: 0.27, fat: 9.83, alcohol: 0, vitamin_d: 0.25, iron: 1.8 });
  });

  it("maps the real BLS 4.0 xlsx headers", () => {
    const rows = [
      {
        "BLS Code": "C133000",
        Lebensmittelbezeichnung: "Hafer Flocken",
        "Food name": "Oat flakes",
        "ENERCC Energie (Kilokalorien) [kcal/100g]": 348,
        "ENERCC Datenherkunft": "Formelberechnung",
        "PROT625 Protein (Nx6,25) [g/100g]": 10.07,
        "FAT Fett [g/100g]": 7,
        "CHO Kohlenhydrate, verfügbar [g/100g]": 60,
        "NA Natrium [mg/100g]": 4,
        "FASAT Fettsäuren, gesättigt, gesamt [g/100g]": 1.3,
        "VITD Vitamin D [µg/100g]": 0,
      },
    ];
    const [oats] = parseTabular(rows, BLS_SPEC);
    expect(oats).toMatchObject({ source: "bls", sourceRef: "C133000", name: "Oat flakes", names: { de: "Hafer Flocken" } });
    expect(oats!.nutrients).toEqual({ energy: 348, protein: 10.07, fat: 7, carbs: 60, sodium: 4, saturated_fat: 1.3, vitamin_d: 0 });
  });

  it("reports required nutrients with no matching column", () => {
    expect(() => parseTabular([{ alim_code: "1", alim_nom_eng: "x" }], CIQUAL_SPEC)).toThrow(/energy, protein, fat, carbs/);
  });
});
