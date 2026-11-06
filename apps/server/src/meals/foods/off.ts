/**
 * Open Food Facts (ODbL): on-demand barcode and text lookups; results are cached per product through upsertFoods.
 * Never import a full dump (that would make our derived database ODbL). https://openfoodfacts.github.io/openfoodfacts-server/api/
 */
import type { ImportedFood, NutrientKey } from "./store";

export type OffFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const BASE = "https://world.openfoodfacts.org";
const HEADERS = { "User-Agent": "VITLS/0.1 (https://vitls.ai)" };
const TIMEOUT_MS = 3000;
const FIELDS = "code,product_name,brands,serving_quantity,nutriments";
const MAX_KCAL_100G = 1000;

/** OFF nutriment (per 100 g, in grams unless noted) → our key and factor to our unit. */
const OFF_NUTRIENTS: [string, NutrientKey, number][] = [
  ["energy-kcal_100g", "energy", 1],
  ["proteins_100g", "protein", 1],
  ["fat_100g", "fat", 1],
  ["saturated-fat_100g", "saturated_fat", 1],
  ["carbohydrates_100g", "carbs", 1],
  ["sugars_100g", "sugars", 1],
  ["fiber_100g", "fiber", 1],
  ["sodium_100g", "sodium", 1000],
  ["potassium_100g", "potassium", 1000],
  ["cholesterol_100g", "cholesterol", 1000],
  ["calcium_100g", "calcium", 1000],
  ["iron_100g", "iron", 1000],
  ["magnesium_100g", "magnesium", 1000],
  ["vitamin-c_100g", "vitamin_c", 1000],
  ["vitamin-d_100g", "vitamin_d", 1_000_000],
  ["caffeine_100g", "caffeine", 1000],
];

type OffProduct = { code?: string; product_name?: string; brands?: string; serving_quantity?: number; nutriments?: Record<string, unknown> };

async function getJson(url: string, fetcher: OffFetch, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { headers: HEADERS, signal: controller.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Only finite numbers and non-empty numeric strings count; null/"" are missing, not 0. */
function num(v: unknown): number | undefined {
  if (typeof v === "string" && v.trim() === "") return undefined;
  if (typeof v !== "number" && typeof v !== "string") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
}

/** `requested` is the barcode the user asked for; it is what we cache by (OFF may return a normalized code). */
function toFood(p: OffProduct, requested?: string): ImportedFood | null {
  if (!p.code || !p.product_name?.trim()) return null;
  const n = p.nutriments ?? {};
  const nutrients: Partial<Record<NutrientKey, number>> = {};
  for (const [field, key, factor] of OFF_NUTRIENTS) {
    const v = num(n[field]);
    // Per 100 g nothing exceeds 100 g (or ~900 kcal); larger values are crowd-sourced typos and count as missing.
    if (v !== undefined && v >= 0 && v <= (key === "energy" ? MAX_KCAL_100G : 100)) nutrients[key] = v * factor;
  }
  // Labels give salt, not sodium: sodium = salt / 2.5.
  const salt = num(n["salt_100g"]);
  if (nutrients.sodium === undefined && salt !== undefined && salt >= 0 && salt <= 100) nutrients.sodium = (salt / 2.5) * 1000;
  if (nutrients.energy === undefined) return null;
  return {
    source: "off",
    sourceRef: p.code,
    barcode: requested ?? p.code,
    name: p.product_name.trim(),
    brand: p.brands?.split(",")[0]?.trim() || undefined,
    basis: "100g",
    nutrients,
    portions: Number(p.serving_quantity) > 0 ? [{ label: "1 serving", amount: Number(p.serving_quantity) }] : [],
  };
}

export async function offProduct(barcode: string, fetcher: OffFetch = fetch as unknown as OffFetch, timeoutMs = TIMEOUT_MS): Promise<ImportedFood | null> {
  const body = (await getJson(`${BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`, fetcher, timeoutMs)) as { status?: number; product?: OffProduct; code?: string } | null;
  return body?.status === 1 && body.product ? toFood({ ...body.product, code: body.product.code ?? body.code ?? barcode }, barcode) : null;
}

export async function offSearch(query: string, fetcher: OffFetch = fetch as unknown as OffFetch, timeoutMs = TIMEOUT_MS): Promise<ImportedFood[]> {
  const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=10&fields=${FIELDS}`;
  const body = (await getJson(url, fetcher, timeoutMs)) as { products?: OffProduct[] } | null;
  return (body?.products ?? []).flatMap((p) => toFood(p) ?? []);
}
