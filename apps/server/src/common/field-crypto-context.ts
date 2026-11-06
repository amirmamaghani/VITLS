/**
 * Owner context for field encryption (replaces the agent-native request context).
 *
 * This backend is single-tenant / owner-scoped: encrypted field keys are derived with the
 * owner's email as salt. `runWithOwner` binds that owner for the duration of a request so the
 * drizzle `customType` adapters can read it via `currentOwner()` inside toDriver/fromDriver.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const ownerStore = new AsyncLocalStorage<string>();

/** Runs `fn` with `ownerEmail` bound as the current owner (sync or async callback). */
export function runWithOwner<T>(ownerEmail: string, fn: () => T): T {
  return ownerStore.run(ownerEmail, fn);
}

/** The owner bound by the nearest enclosing `runWithOwner`, or undefined outside one. */
export function currentOwner(): string | undefined {
  return ownerStore.getStore();
}
