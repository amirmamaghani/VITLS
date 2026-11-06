/** Thin wrapper over the gccli binary (https://gccli.sh). Garmin credentials stay in gccli's own keyring. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Runs `gccli -j <args>` and parses JSON; returns undefined (with a warning) when the call fails. */
export async function gccli<T = any>(...args: string[]): Promise<T | undefined> {
  try {
    const { stdout } = await run("gccli", ["-j", ...args], { maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = (error as { stderr?: string; message: string }).stderr?.trim() || (error as Error).message;
    console.warn(`  ! gccli ${args.join(" ")}: ${message.split("\n")[0]}`);
    return undefined;
  }
}

export async function gccliAuthStatus(): Promise<string> {
  try {
    const { stdout } = await run("gccli", ["auth", "status"]);
    return stdout.trim();
  } catch {
    return "not authenticated — run `gccli auth login`";
  }
}
