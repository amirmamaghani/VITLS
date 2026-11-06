/**
 * Food search (docs/design/06-nutrition.md §5): local database first (any language, diacritics-insensitive),
 * Open Food Facts for unmatched barcodes and when local results are thin; OFF hits are cached.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, schema } from "../../db";
import { searchKey } from "./normalize";
import { offProduct, offSearch, type OffFetch } from "./off";
import { foodByBarcode, getFoods, upsertFoods, type Food } from "./store";

const SOURCE_RANK: Record<string, number> = { custom: 0, ciqual: 1, bls: 2, usda: 3, off: 4 };
const OFF_REFRESH_MS = 90 * 86_400_000;

function score(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  const words = name.split(" ");
  const tokens = query.split(" ");
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) return 2;
  return 3;
}

async function localSearch(query: string, viewer: string, limit: number): Promise<Food[]> {
  const key = searchKey(query);
  const tokens = key.split(" ").filter(Boolean).slice(0, 6);
  if (tokens.length === 0) return [];
  const db = getDb();
  const n = schema.foodNames;
  const f = schema.foods;
  const escape = (t: string) => t.replace(/[\\%_]/g, "\\$&");
  // Rank before the limit, or common words ("chicken") would cut the exact and prefix matches.
  const rows = await db
    .select({ id: n.foodId, searchName: n.searchName, source: f.source })
    .from(n)
    .innerJoin(f, eq(f.id, n.foodId))
    .where(and(...tokens.map((t) => sql`${n.searchName} LIKE ${`%${escape(t)}%`} ESCAPE ${"\\"}`), or(isNull(f.createdBy), eq(f.createdBy, viewer))))
    .orderBy(sql`(${n.searchName} = ${key}) DESC`, sql`(${n.searchName} LIKE ${`${escape(key)}%`} ESCAPE ${"\\"}) DESC`, sql`length(${n.searchName})`)
    .limit(300);
  const best = new Map<string, { score: number; source: string; length: number }>();
  for (const r of rows) {
    const s = { score: score(r.searchName, key), source: r.source, length: r.searchName.length };
    const prev = best.get(r.id);
    if (!prev || s.score < prev.score) best.set(r.id, s);
  }
  const ids = [...best.entries()]
    .sort(([, a], [, b]) => a.score - b.score || (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9) || a.length - b.length)
    .slice(0, limit)
    .map(([id]) => id);
  const foods = await getFoods(ids, viewer);
  return ids.flatMap((id) => foods.get(id) ?? []);
}

export async function searchFoods(input: { query?: string; barcode?: string; viewer: string; limit?: number; fetcher?: OffFetch; timeoutMs?: number }): Promise<Food[]> {
  const limit = Math.min(input.limit ?? 10, 25);
  if (input.barcode) {
    const cached = await foodByBarcode(input.barcode, input.viewer);
    const fresh = cached && (cached.source !== "off" || (await isFresh(cached.id)));
    if (cached && fresh) return [cached];
    const remote = await offProduct(input.barcode, input.fetcher, input.timeoutMs);
    if (!remote) return cached ? [cached] : [];
    const { ids } = await upsertFoods([remote]);
    return [...(await getFoods(ids, input.viewer)).values()];
  }
  const local = input.query ? await localSearch(input.query, input.viewer, limit) : [];
  if (local.length >= 3 || !input.query) return local;
  const remote = await offSearch(input.query, input.fetcher, input.timeoutMs);
  if (remote.length === 0) return local;
  const { ids } = await upsertFoods(remote);
  const cached = await getFoods(ids, input.viewer);
  return [...local, ...ids.flatMap((id) => cached.get(id) ?? [])].slice(0, limit);
}

async function isFresh(foodId: string): Promise<boolean> {
  const [row] = await getDb().select({ refreshedAt: schema.foods.refreshedAt }).from(schema.foods).where(inArray(schema.foods.id, [foodId]));
  return !!row && Date.now() - Date.parse(row.refreshedAt) < OFF_REFRESH_MS;
}
