/** Local, git-ignored state: server URL, device token (secret), and the sync cursor. */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SyncState {
  server: string;
  token: string;
  deviceId: string;
  /** Last calendar day fully pushed (YYYY-MM-DD); the next sync restarts one day earlier to catch late data. */
  cursor?: string;
  lastRunAt?: string;
}

const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", ".state", "state.json");

export async function loadState(): Promise<SyncState | undefined> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as SyncState;
  } catch {
    return undefined;
  }
}

/** Writes atomically with owner-only permissions (the file holds a device token). */
export async function saveState(state: SyncState): Promise<void> {
  const dir = dirname(STATE_FILE);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const tmp = `${STATE_FILE}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
  await rename(tmp, STATE_FILE);
}
