import { callAction } from "@agent-native/core/client/hooks";

import { downloadFile } from "@/lib/export";

import type { DataCatalog } from "../../../server/lib/health/catalog";
import type { RawResult } from "../../../server/lib/health/raw";

const SECTIONS = new Set(["sleep", "workouts", "meals"]);

/** Walks every window of one key (metric or section) until nextBefore is null; newest first. */
export async function loadAllRows(key: string): Promise<RawResult["rows"]> {
  const query = SECTIONS.has(key) ? { section: key } : { metric: key };
  const rows: RawResult["rows"] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 400; guard++) {
    const page = (await callAction("get-health-raw", { ...query, before, days: 366 } as never, { method: "GET" })) as RawResult;
    rows.push(...page.rows);
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }
  return rows;
}

/** One JSON file with every metric and section that has rows. */
export async function exportEverything(catalog: DataCatalog): Promise<void> {
  const keys = [
    ...catalog.metrics.filter((m) => m.rows > 0 && m.kind !== "intraday").map((m) => m.key),
    ...(["sleep", "workouts", "meals"] as const).filter((s) => catalog.sections[s].rows > 0),
  ];
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), sources: catalog.sources };
  for (const key of keys) out[key] = await loadAllRows(key);
  downloadFile(`vitls-data-${new Date().toISOString().slice(0, 10)}.json`, "application/json", JSON.stringify(out, null, 2));
}
