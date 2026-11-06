/** Tiny read-through cache: in-memory for an instant first paint, mirrored to SecureStore so it also
    survives app restarts. Used for Today, board configs and metric values so screens show instantly and
    don't reload on every visit; a pull-to-refresh / focus fetch updates them. Cleared on sign-out. */
import * as SecureStore from "expo-secure-store";

const mem = new Map<string, unknown>();
const keys = new Set<string>(); // for wiping persisted entries on sign-out
const diskKey = (k: string) => `vitls-cache:${k}`;

/** Synchronous in-memory read (undefined if this session hasn't loaded it yet). */
export const cacheGet = <T>(key: string): T | undefined => mem.get(key) as T | undefined;

/** In-memory, else hydrate from disk (survives restarts). */
export async function cacheLoad<T>(key: string): Promise<T | undefined> {
  if (mem.has(key)) return mem.get(key) as T;
  try {
    const raw = await SecureStore.getItemAsync(diskKey(key));
    if (raw) {
      const v = JSON.parse(raw) as T;
      mem.set(key, v);
      keys.add(key);
      return v;
    }
  } catch {
    /* ignore a corrupt/empty cache */
  }
  return undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  mem.set(key, value);
  keys.add(key);
  void SecureStore.setItemAsync(diskKey(key), JSON.stringify(value)).catch(() => {});
}

/** Drop everything (on sign-out, so the next user never sees the previous one's data). */
export function cacheClearAll(): void {
  for (const k of keys) void SecureStore.deleteItemAsync(diskKey(k)).catch(() => {});
  mem.clear();
  keys.clear();
}
