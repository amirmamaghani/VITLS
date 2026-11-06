/** Deterministic <devices> block for the coach prompt: what is paired, when data last arrived, what the goals still lack. */
import { getToday } from "../devices/today";
import { listDevices, type OwnerScope } from "../ingest/devices";

export async function devicesContext(owner: OwnerScope): Promise<string> {
  const [devices, today] = await Promise.all([listDevices(owner), getToday(owner)]);
  const active = devices.filter((d) => !d.revokedAt);
  return [
    "<devices>",
    active.length
      ? `paired: ${active.map((d) => `${d.platform}${d.label ? ` (${d.label})` : ""}`).join(", ")}`
      : "paired: no device paired yet — offer the companion app in the data stage",
    `last batch: ${today.lastBatchAt ?? "never"}`,
    `goal metrics with no data in the last 14 days: ${today.missing.length ? today.missing.join(", ") : "none"}`,
    "</devices>",
  ].join("\n");
}
