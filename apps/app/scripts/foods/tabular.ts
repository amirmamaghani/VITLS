/** Wide food composition tables (one row per food, one column per constituent), mapped by header regexes. */
import ExcelJS from "exceljs";
import type { NutrientKey } from "@vitls/health-ingest";

import type { FoodSource, ImportedFood } from "../../server/lib/foods/store";

export interface TabularSpec {
  source: FoodSource;
  id: string;
  /** Display-name column; an array is tried in order (first non-empty wins). */
  name: string | string[];
  /** Extra language columns: lang → column. */
  names?: Record<string, string>;
  /** Nutrient → header regex (first matching column wins). */
  columns: Partial<Record<NutrientKey, RegExp>>;
}

const REQUIRED: NutrientKey[] = ["energy", "protein", "fat", "carbs"];

/** "12,5" → 12.5; "traces" → 0; "< 0,5" → half the bound; "-" / "" → undefined. */
export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (v === "traces" || v === "tr") return 0;
  const bound = /^<\s*([\d.,]+)$/.exec(v);
  if (bound) return Number(bound[1]!.replace(",", ".")) / 2;
  const n = Number(v.replace(",", "."));
  return v && Number.isFinite(n) ? n : undefined;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

export function parseTabular(rows: Record<string, unknown>[], spec: TabularSpec): ImportedFood[] {
  const headers = Object.keys(rows[0] ?? {});
  const mapping = Object.entries(spec.columns).flatMap(([key, re]) => {
    const header = headers.find((h) => re!.test(h));
    return header ? [[key as NutrientKey, header] as const] : [];
  });
  const missing = REQUIRED.filter((k) => !mapping.some(([key]) => key === k));
  if (missing.length) throw new Error(`${spec.source}: no column for ${missing.join(", ")} — check the header regexes against the file`);
  return rows.flatMap((row) => {
    const id = String(row[spec.id] ?? "").trim();
    const name = [spec.name].flat().map((c) => clean(row[c])).find(Boolean) ?? "";
    if (!id || !name) return [];
    const nutrients: Partial<Record<NutrientKey, number>> = {};
    for (const [key, header] of mapping) {
      const v = toNumber(row[header]);
      if (v !== undefined) nutrients[key] = v;
    }
    const names = Object.fromEntries(
      Object.entries(spec.names ?? {}).flatMap(([lang, col]) => {
        const n = clean(row[col]);
        return n ? [[lang, n]] : [];
      }),
    );
    return [{ source: spec.source, sourceRef: id, name, names, basis: "100g" as const, nutrients }];
  });
}

/** First worksheet (or `sheet`) as objects keyed by the header row. */
export async function readXlsx(file: string, sheet = 1): Promise<Record<string, unknown>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[sheet - 1];
  if (!ws) throw new Error(`${file}: no worksheet ${sheet}`);
  const header = (ws.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? "").replace(/\s+/g, " ").trim());
  const rows: Record<string, unknown>[] = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const values = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(header.map((h, j) => [h, (values[j] as { result?: unknown })?.result ?? values[j]])));
  });
  return rows;
}
