# Companion Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/companion` into the single mobile entry point: a native Today screen (readout, numbers, weight quick log), the PWA in a WebView, native push, one magic-link sign-in that also pairs the device, and a coach that notices when data arrives.

**Architecture:** The server grows three device-token routes (`today`, `log`, `push`), one Expo push notification channel, a first-batch notification and a `<devices>` block in the coach context. The PWA gains a shell-mode helper that hides pricing and auto-pairs through a tiny postMessage bridge. The companion gets three tabs (Today, Coach WebView, Settings) plus a login screen; the existing sync/health/background code is reused untouched.

**Tech Stack:** Nitro/h3 routes + drizzle (apps/app), vitest + PGlite tests, `expo-server-sdk` (server push), Expo SDK 57 with `react-native-webview`, `expo-notifications`, `expo-linking`, `expo-router` tabs.

**Spec:** `docs/superpowers/specs/2026-10-10-companion-shell-design.md`

## Global Constraints

- No purchase, price, plan name, upgrade or billing link anywhere in the companion, nor in the PWA while `isShell()` is true. The free tier must work fully in the app.
- The device token (`vdt_…`, scope `ingest:write`) authenticates only `/api/ingest/v1/batches`, `/api/devices/today`, `/api/devices/log`, `/api/devices/push`. It never reads chat, dashboards or settings.
- Bridge messages are `{ v: 1, type, ...payload }`; unknown `v` or `type` is dropped silently on both sides. Types: `pair`, `sync-now` (web→native), `sync-status` (native→web).
- User agent suffix in the WebView is exactly `VITLSCompanion/<app version>`; the injected global is `window.vitlsShell = { v: 1, platform }`.
- `vitls-push` user setting keeps its `subscriptions` array; Expo tokens are entries `{ kind: "expo", token, label?, createdAt }`; the cap stays `MAX_SUBSCRIPTIONS = 10` across both kinds.
- Companion: Expo SDK 57, install packages with `npx expo install`, native code via `npx expo prebuild --platform android --no-install` then `cd android && ./gradlew assembleDebug` (the `android/` folder is gitignored).
- Server tests: `pnpm --filter @vitls/app test -- <path>`; companion checks: `npx tsc --noEmit -p apps/companion`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A revoked device calling `today`/`log`/`push` must get 401 and the companion must then drop its state and show the login screen (Task 3, Task 12 tests).
2. A quick-log entry for an `intake_*` or intraday metric must be rejected with 400, never stored (Task 3 test).
3. An Expo push token that Expo reports as `DeviceNotRegistered` must be pruned; a Web Push subscription in the same array must survive (Task 5 test).
4. The first-batch notification must fire exactly once per device, not on duplicate batches and not on the second batch (Task 6 test).
5. A bridge message with `v: 2` or an unknown `type` must be ignored by both the PWA and the native layer without throwing (Task 8 and Task 11 tests).

---

### Task 1: Server — `today` summary lib

**Files:**
- Create: `apps/app/server/lib/devices/today.ts`
- Test: `apps/app/server/lib/devices/today.test.ts`

**Interfaces:**
- Consumes: `getReadout(userEmail)` from `server/lib/coach/readout.ts`; `getHealth(userEmail, query)` from `server/lib/health/read.ts`; `getCoachProfile(owner)` from `server/lib/coach/profile.ts` (returns `{ profile: { timezone?, goals?: { module }[] }, ... }`); `GOAL_MODULES` from `shared/coach.ts`; `schema.healthSources` from `server/db/schema.ts`.
- Produces: `getToday(owner: OwnerScope): Promise<TodayView>` where
  ```ts
  export interface TodayView {
    date: string;                                   // YYYY-MM-DD in the user's timezone
    readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;
    metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
    lastBatchAt: string | null;                     // newest healthSources.lastSyncAt or null
    missing: string[];                              // metric keys the user's goals need with no value in the last 14 days
  }
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/server/lib/devices/today.test.ts
import { randomUUID } from "node:crypto";

import { ingestBatchSchema } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { saveReadout } from "../coach/readout";
import { updateCoachProfile } from "../coach/profile";
import { createPairing, redeemPairing } from "../ingest/devices";
import { ingestBatch } from "../ingest/ingest";
import { getToday } from "./today";

const owner = { userEmail: "tina@example.com", orgId: "org_tina" };
const FREE = { intraday: false, rawRetentionDays: 30 };
const today = new Date().toISOString().slice(0, 10);

async function pairedIdentity() {
  const { code } = await createPairing(owner);
  const { deviceId } = await redeemPairing(code, { platform: "android" });
  return { ...owner, deviceId, scope: "ingest:write" };
}

describe("today view", () => {
  beforeAll(setupTestDb);

  it("is empty but well-formed for a fresh user", async () => {
    expect(await getToday(owner)).toEqual({ date: today, readout: null, metrics: {}, lastBatchAt: null, missing: [] });
  });

  it("returns the readout, today's numbers and goal metrics nobody provides", async () => {
    await updateCoachProfile(owner.userEmail, { timezone: "UTC", goals: [{ module: "endurance", priority: 1, targets: {} }] });
    await saveReadout(owner.userEmail, { date: today, directive: "Easy run.", highlights: [{ metric: "steps", note: "on track" }] });
    const identity = await pairedIdentity();
    await ingestBatch({
      identity,
      batch: ingestBatchSchema.parse({
        batchId: randomUUID(),
        sentAt: new Date().toISOString(),
        source: { provider: "health_connect", via: "companion" },
        daily: [
          { externalId: `steps:${today}`, date: today, metric: "steps", value: 8200, unit: "count" },
          { externalId: `resting_hr:${today}`, date: today, metric: "resting_hr", value: 52, unit: "bpm" },
          { externalId: `distance:${today}`, date: today, metric: "distance", value: 5000, unit: "m" },
        ],
      }),
      entitlements: FREE,
    });
    const view = await getToday(owner);
    expect(view.readout?.directive).toBe("Easy run.");
    expect(view.metrics).toEqual({ steps: 8200, resting_hr: 52 });
    expect(view.lastBatchAt).not.toBeNull();
    // endurance needs vo2max, distance, resting_hr, hrv_rmssd_night; two of them arrived
    expect(view.missing).toEqual(["vo2max", "hrv_rmssd_night"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/lib/devices/today.test.ts`
Expected: FAIL with "Cannot find module './today'"

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/app/server/lib/devices/today.ts
/** Native "Today" screen of the companion: readout + three numbers + what the user's goals still lack. Read-only. */
import { desc, eq } from "drizzle-orm";

import { GOAL_MODULES } from "../../../shared/coach";
import { getDb, schema } from "../../db";
import { getCoachProfile } from "../coach/profile";
import { getReadout } from "../coach/readout";
import { getHealth } from "../health/read";
import type { OwnerScope } from "../ingest/devices";

export interface TodayView {
  date: string;
  readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;
  metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
  lastBatchAt: string | null;
  missing: string[];
}

const LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

export async function getToday(owner: OwnerScope): Promise<TodayView> {
  const { profile } = await getCoachProfile(owner.userEmail);
  const tz = profile.timezone ?? "UTC";
  const date = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const from = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toLocaleDateString("en-CA", { timeZone: tz });
  const [readout, health, [source]] = await Promise.all([
    getReadout(owner.userEmail),
    getHealth(owner.userEmail, { from, to: date, include: ["daily", "points", "sleep"] }),
    getDb()
      .select({ lastSyncAt: schema.healthSources.lastSyncAt })
      .from(schema.healthSources)
      .where(eq(schema.healthSources.ownerEmail, owner.userEmail))
      .orderBy(desc(schema.healthSources.lastSyncAt))
      .limit(1),
  ]);

  const todayValue = (metric: string) => health.daily?.[metric]?.values.find((v) => v.date === date)?.value;
  const metrics: TodayView["metrics"] = {};
  const steps = todayValue("steps");
  const restingHr = todayValue("resting_hr");
  const sleepMin = todayValue("sleep_duration");
  if (steps !== undefined) metrics.steps = steps;
  if (restingHr !== undefined) metrics.resting_hr = restingHr;
  if (sleepMin !== undefined) metrics.sleep_min = sleepMin;

  const seen = new Set([...Object.keys(health.daily ?? {}), ...Object.keys(health.points ?? {})]);
  const needed = [...new Set((profile.goals ?? []).flatMap((g) => GOAL_MODULES[g.module]?.metrics ?? []))];
  return {
    date,
    readout: readout ? { greeting: readout.greeting, directive: readout.directive, highlights: readout.highlights } : null,
    metrics,
    lastBatchAt: source?.lastSyncAt ?? null,
    missing: needed.filter((m) => !seen.has(m)),
  };
}
```

If `getHealth` omits metrics with no values from `daily`/`points` (check `read.ts`; if it returns every catalog metric with an empty `values` array, replace `seen` with the set of keys whose `values.length > 0`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vitls/app test -- server/lib/devices/today.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/lib/devices/today.ts apps/app/server/lib/devices/today.test.ts
git commit -m "feat(app): today view for the companion (readout, numbers, missing goal metrics)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Server — `GET /api/devices/today` route

**Files:**
- Create: `apps/app/server/routes/api/devices/today.get.ts`
- Test: `apps/app/server/routes/api/devices/today.test.ts`

**Interfaces:**
- Consumes: `requireDevice(event)`, `deviceRoute(event, handler)` from `server/lib/ingest/http.ts`; `getToday(owner)` from Task 1.
- Produces: `GET /api/devices/today` → `TodayView` JSON, 401 `{ error, errorCode: "unauthorized" }` without a valid token.

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/server/routes/api/devices/today.test.ts
import { mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import { createPairing, redeemPairing, revokeDevice } from "../../../lib/ingest/devices";
import handler from "./today.get";

vi.mock("@agent-native/core/org", async (importOriginal) => ({ ...(await importOriginal<object>()), isOrgMember: async () => true }));

const owner = { userEmail: "ron@example.com", orgId: "org_ron" };
const get = (token?: string) =>
  mockEvent("http://localhost/api/devices/today", { method: "GET", headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("GET /api/devices/today", () => {
  beforeAll(setupTestDb);

  it("returns the view for a paired device", async () => {
    const { code } = await createPairing(owner);
    const { token } = await redeemPairing(code, { platform: "android" });
    const body = (await handler(get(token))) as { date: string; metrics: object };
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.metrics).toEqual({});
  });

  it("answers 401 without a token and after revocation", async () => {
    const event = get();
    expect(await handler(event)).toMatchObject({ errorCode: "unauthorized" });
    const { code } = await createPairing(owner);
    const { token, deviceId } = await redeemPairing(code, { platform: "android" });
    await revokeDevice(owner, deviceId);
    expect(await handler(get(token))).toMatchObject({ errorCode: "unauthorized" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/routes/api/devices/today.test.ts`
Expected: FAIL with "Cannot find module './today.get'"

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/app/server/routes/api/devices/today.get.ts
/** GET /api/devices/today — the companion's native Today screen. Auth: device token. */
import { defineEventHandler } from "h3";

import { getToday } from "../../../lib/devices/today";
import { deviceRoute, requireDevice } from "../../../lib/ingest/http";

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    return getToday(identity);
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vitls/app test -- server/routes/api/devices/today.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/routes/api/devices/today.get.ts apps/app/server/routes/api/devices/today.test.ts
git commit -m "feat(app): GET /api/devices/today for the companion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Server — `POST /api/devices/log` quick log route

**Files:**
- Create: `apps/app/server/routes/api/devices/log.post.ts`
- Test: `apps/app/server/routes/api/devices/log.test.ts`

**Interfaces:**
- Consumes: `logManual(owner, { entries })` from `server/lib/ingest/manual.ts` (throws `Error` for intake/intraday metrics); `requireDevice`, `deviceRoute`; `readBodyWithSizeLimit` from `@agent-native/core/server`.
- Produces: `POST /api/devices/log` body `{ entries: [{ metric, value, unit?, date }] }` (max 20 entries, `date` = `YYYY-MM-DD` or ISO timestamp) → `{ stored: number }`; 400 `{ errorCode: "invalid_entry" }` when the metric cannot be logged manually.

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/server/routes/api/devices/log.test.ts
import { mockEvent } from "h3";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../../test/db";
import { getHealth } from "../../../lib/health/read";
import { createPairing, redeemPairing } from "../../../lib/ingest/devices";
import handler from "./log.post";

vi.mock("@agent-native/core/org", async (importOriginal) => ({ ...(await importOriginal<object>()), isOrgMember: async () => true }));

const owner = { userEmail: "lea@example.com", orgId: "org_lea" };
const post = (token: string, body: unknown) =>
  mockEvent("http://localhost/api/devices/log", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/devices/log", () => {
  beforeAll(setupTestDb);
  let token = "";
  beforeAll(async () => {
    const { code } = await createPairing(owner);
    token = (await redeemPairing(code, { platform: "ios" })).token;
  });

  it("stores a weight as a manual point", async () => {
    expect(await handler(post(token, { entries: [{ metric: "weight", value: 81.4, date: "2026-10-10" }] }))).toEqual({ stored: 1 });
    const h = await getHealth(owner.userEmail, { from: "2026-10-10", to: "2026-10-10", include: ["points"] });
    expect(h.points!.weight!.values[0]).toMatchObject({ value: 81.4, source: "manual" });
  });

  it("rejects intake and intraday metrics with 400", async () => {
    const event = post(token, { entries: [{ metric: "intake_energy", value: 500, date: "2026-10-10" }] });
    expect(await handler(event)).toMatchObject({ errorCode: "invalid_entry" });
    expect(event.node.res.statusCode).toBe(400);
    expect(await handler(post(token, { entries: [{ metric: "heart_rate", value: 70, date: "2026-10-10" }] }))).toMatchObject({ errorCode: "invalid_entry" });
  });

  it("rejects more than 20 entries", async () => {
    const entries = Array.from({ length: 21 }, (_, i) => ({ metric: "weight", value: 80 + i, date: "2026-10-10" }));
    expect(await handler(post(token, { entries }))).toMatchObject({ errorCode: "invalid_payload" });
  });
});
```

If `event.node.res.statusCode` is not how `mockEvent` exposes the status in this h3 version, check `server/lib/ingest/http.test.ts` for the pattern it uses and copy it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/routes/api/devices/log.test.ts`
Expected: FAIL with "Cannot find module './log.post'"

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/app/server/routes/api/devices/log.post.ts
/** POST /api/devices/log — quick manual entries from the companion's Today screen. Auth: device token. */
import { ActionContractError } from "@agent-native/core/action";
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { logManual } from "../../../lib/ingest/manual";

const bodySchema = z.object({
  entries: z
    .array(z.object({ metric: z.string().min(1).max(40), value: z.number().finite(), unit: z.string().max(20).optional(), date: z.string().min(10).max(40) }))
    .min(1)
    .max(20),
});

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { entries } = bodySchema.parse(await readBodyWithSizeLimit(event, 8 * 1024));
    try {
      const result = await logManual(identity, { entries: entries.map((e) => ({ metric: e.metric, value: e.value, unit: e.unit, when: e.date })) });
      return { stored: result.stored.daily + result.stored.points };
    } catch (error) {
      throw new ActionContractError((error as Error).message, { errorCode: "invalid_entry", statusCode: 400 });
    }
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @vitls/app test -- server/routes/api/devices/log.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/routes/api/devices/log.post.ts apps/app/server/routes/api/devices/log.test.ts
git commit -m "feat(app): POST /api/devices/log quick entries from the companion

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Server — Expo tokens in the `vitls-push` setting

**Files:**
- Modify: `apps/app/server/lib/notifications/web-push.ts` (the `StoredSubscription` type, `listSubscriptions`, `addSubscription`, `removeSubscription`, `createWebPushChannel` filter)
- Test: `apps/app/server/lib/notifications/web-push.test.ts` (add cases)

**Interfaces:**
- Produces, exported from `web-push.ts`:
  ```ts
  export type StoredEntry =
    | ({ kind?: "webpush"; label?: string; createdAt: string } & PushSubscription)
    | { kind: "expo"; token: string; label?: string; createdAt: string };
  export async function listEntries(userEmail: string): Promise<StoredEntry[]>;
  export async function addExpoToken(userEmail: string, token: string, label?: string): Promise<void>;
  export async function removeExpoToken(userEmail: string, token: string): Promise<void>;
  ```
  Web Push entries have no `kind` (backward compatible with what is stored today). `createWebPushChannel` only sends to entries without `kind: "expo"`; `addSubscription`/`removeSubscription` keep Expo entries untouched.

- [ ] **Step 1: Write the failing tests** (append to the existing `describe`)

```ts
  it("stores expo tokens beside web push subscriptions and keeps them apart", async () => {
    const { addExpoToken, removeExpoToken, listEntries } = await import("./web-push");
    await addExpoToken(user, "ExponentPushToken[abc]", "Pixel 8");
    await addExpoToken(user, "ExponentPushToken[abc]", "Pixel 8 again");
    const entries = await listEntries(user);
    expect(entries.filter((e) => e.kind === "expo")).toHaveLength(1);
    expect(entries.some((e) => !e.kind && (e as { endpoint: string }).endpoint === "https://push.example/phone")).toBe(true);

    const channel = createWebPushChannel({ publicKey: "pk", privateKey: "sk", subject: "mailto:x@y.z" });
    sent.length = 0;
    await channel.deliver({ severity: "info", title: "x" }, { owner: user });
    expect(sent).toEqual(["https://push.example/phone"]); // the expo token is not a web push endpoint

    await removeExpoToken(user, "ExponentPushToken[abc]");
    expect((await listEntries(user)).filter((e) => e.kind === "expo")).toHaveLength(0);
    expect((await listEntries(user)).length).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/lib/notifications/web-push.test.ts`
Expected: FAIL with "addExpoToken is not a function"

- [ ] **Step 3: Implement**

Replace the `StoredSubscription` interface and the three store functions in `web-push.ts` with:

```ts
export type StoredEntry =
  | ({ kind?: "webpush"; label?: string; createdAt: string } & PushSubscription)
  | { kind: "expo"; token: string; label?: string; createdAt: string };

const isExpo = (e: StoredEntry): e is Extract<StoredEntry, { kind: "expo" }> => e.kind === "expo";

export async function listEntries(userEmail: string): Promise<StoredEntry[]> {
  const value = await getUserSetting(userEmail, SETTING_KEY);
  return Array.isArray(value?.subscriptions) ? (value.subscriptions as StoredEntry[]) : [];
}

async function replaceEntries(userEmail: string, update: (entries: StoredEntry[]) => StoredEntry[]) {
  await mutateUserSetting(userEmail, SETTING_KEY, (current) => ({
    subscriptions: update(Array.isArray(current?.subscriptions) ? (current.subscriptions as StoredEntry[]) : []).slice(-MAX_SUBSCRIPTIONS),
  }));
}

export async function addSubscription(userEmail: string, subscription: PushSubscription, label?: string) {
  await replaceEntries(userEmail, (entries) => [
    ...entries.filter((e) => isExpo(e) || e.endpoint !== subscription.endpoint),
    { ...subscription, label, createdAt: new Date().toISOString() },
  ]);
}

export async function removeSubscription(userEmail: string, endpoint: string) {
  await replaceEntries(userEmail, (entries) => entries.filter((e) => isExpo(e) || e.endpoint !== endpoint));
}

export async function addExpoToken(userEmail: string, token: string, label?: string) {
  await replaceEntries(userEmail, (entries) => [
    ...entries.filter((e) => !isExpo(e) || e.token !== token),
    { kind: "expo", token, label, createdAt: new Date().toISOString() },
  ]);
}

export async function removeExpoToken(userEmail: string, token: string) {
  await replaceEntries(userEmail, (entries) => entries.filter((e) => !isExpo(e) || e.token !== token));
}
```

In `createWebPushChannel.deliver`, replace `const subscriptions = await listSubscriptions(meta.owner);` with
`const subscriptions = (await listEntries(meta.owner)).filter((e): e is Exclude<StoredEntry, { kind: "expo" }> => !isExpo(e));`
and delete the old `listSubscriptions` and `StoredSubscription`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @vitls/app test -- server/lib/notifications/web-push.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/lib/notifications/web-push.ts apps/app/server/lib/notifications/web-push.test.ts
git commit -m "feat(app): expo push tokens stored beside web push subscriptions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Server — Expo push channel + `POST/DELETE /api/devices/push`

**Files:**
- Create: `apps/app/server/lib/notifications/expo-push.ts`
- Create: `apps/app/server/plugins/expo-push.ts`
- Create: `apps/app/server/routes/api/devices/push.post.ts`
- Create: `apps/app/server/routes/api/devices/push.delete.ts`
- Test: `apps/app/server/lib/notifications/expo-push.test.ts`
- Modify: `apps/app/package.json` (dependency `expo-server-sdk`)

**Interfaces:**
- Consumes: `listEntries`, `removeExpoToken`, `addExpoToken` from Task 4; `NotificationChannel`, `registerNotificationChannel` from `@agent-native/core/notifications`.
- Produces: `createExpoPushChannel(): NotificationChannel` with `name: "expo"`, payload `{ to, title, body, data: { url } }` where `url = input.metadata?.url ?? "/home"`; routes `POST /api/devices/push { expoToken }` → `{ ok: true }`, `DELETE /api/devices/push { expoToken }` → `{ ok: true }`.

- [ ] **Step 1: Install the SDK**

Run: `pnpm --filter @vitls/app add expo-server-sdk`
Expected: `expo-server-sdk` appears in `apps/app/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

```ts
// apps/app/server/lib/notifications/expo-push.test.ts
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";

const sent: { to: string; data?: { url: string } }[] = [];
vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken = (t: string) => t.startsWith("ExponentPushToken[");
    chunkPushNotifications = (messages: unknown[]) => [messages];
    sendPushNotificationsAsync = async (messages: { to: string; data?: { url: string } }[]) => {
      sent.push(...messages);
      return messages.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }));
    };
  },
}));

const { createExpoPushChannel } = await import("./expo-push");
const { addExpoToken, addSubscription, listEntries } = await import("./web-push");

const user = "ola@example.com";

describe("expo push channel", () => {
  beforeAll(setupTestDb);

  it("delivers to expo tokens with the thread url and prunes dead tokens only", async () => {
    await addSubscription(user, { endpoint: "https://push.example/browser", keys: { p256dh: "p", auth: "a" } });
    await addExpoToken(user, "ExponentPushToken[live]");
    await addExpoToken(user, "ExponentPushToken[dead]");
    const channel = createExpoPushChannel();
    expect(await channel.deliver({ severity: "info", title: "Data arrived", metadata: { url: "/dashboard/x" } }, { owner: user })).toBe(true);
    expect(sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[dead]", "ExponentPushToken[live]"]);
    expect(sent[0]?.data).toEqual({ url: "/dashboard/x" });
    const entries = await listEntries(user);
    expect(entries.map((e) => (e.kind === "expo" ? e.token : (e as { endpoint: string }).endpoint)).sort()).toEqual([
      "ExponentPushToken[live]",
      "https://push.example/browser",
    ]);
  });

  it("reports nothing delivered without expo tokens", async () => {
    expect(await createExpoPushChannel().deliver({ severity: "info", title: "x" }, { owner: "nobody@example.com" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/lib/notifications/expo-push.test.ts`
Expected: FAIL with "Cannot find module './expo-push'"

- [ ] **Step 4: Implement the channel, plugin and routes**

```ts
// apps/app/server/lib/notifications/expo-push.ts
/** Native push for the companion app: one NotificationChannel over Expo's push service, tokens from the vitls-push setting. */
import type { NotificationChannel } from "@agent-native/core/notifications";
import { Expo } from "expo-server-sdk";

import { listEntries, removeExpoToken } from "./web-push";

export const isExpoPushToken = (token: string) => Expo.isExpoPushToken(token);

export function createExpoPushChannel(): NotificationChannel {
  const expo = new Expo();
  return {
    name: "expo",
    async deliver(input, meta) {
      const tokens = (await listEntries(meta.owner)).flatMap((e) => (e.kind === "expo" ? [e.token] : []));
      if (tokens.length === 0) return false;
      const url = typeof input.metadata?.url === "string" ? input.metadata.url : "/home";
      const messages = tokens.map((to) => ({ to, title: input.title, body: input.body ?? "", data: { url }, sound: "default" as const }));
      let delivered = false;
      for (const chunk of expo.chunkPushNotifications(messages)) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        await Promise.all(
          tickets.map((ticket, i) => {
            if (ticket.status === "ok") return (delivered = true);
            return ticket.details?.error === "DeviceNotRegistered" ? removeExpoToken(meta.owner, chunk[i]!.to as string) : undefined;
          }),
        );
      }
      return delivered;
    },
  };
}
```

```ts
// apps/app/server/plugins/expo-push.ts
import { registerNotificationChannel } from "@agent-native/core/notifications";

import { createExpoPushChannel } from "../lib/notifications/expo-push";

/** Registers the Expo push channel (companion app). No config needed: Expo's push service is keyed by the token itself. */
export default (): void => {
  registerNotificationChannel(createExpoPushChannel());
};
```

```ts
// apps/app/server/routes/api/devices/push.post.ts
/** POST /api/devices/push — the companion registers its Expo push token. Auth: device token. */
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceLabelSchema } from "@vitls/health-ingest";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { isExpoPushToken } from "../../../lib/notifications/expo-push";
import { addExpoToken } from "../../../lib/notifications/web-push";

const bodySchema = z.object({ expoToken: z.string().min(10).max(200).refine(isExpoPushToken, "Not an Expo push token"), label: deviceLabelSchema.optional() });

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { expoToken, label } = bodySchema.parse(await readBodyWithSizeLimit(event, 2 * 1024));
    await addExpoToken(identity.userEmail, expoToken, label);
    return { ok: true };
  }),
);
```

```ts
// apps/app/server/routes/api/devices/push.delete.ts
/** DELETE /api/devices/push — the companion removes its Expo push token (disconnect). Auth: device token. */
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { removeExpoToken } from "../../../lib/notifications/web-push";

const bodySchema = z.object({ expoToken: z.string().min(10).max(200) });

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { expoToken } = bodySchema.parse(await readBodyWithSizeLimit(event, 2 * 1024));
    await removeExpoToken(identity.userEmail, expoToken);
    return { ok: true };
  }),
);
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @vitls/app test -- server/lib/notifications` then `pnpm --filter @vitls/app exec tsc --noEmit`
Expected: PASS (6 tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/app/package.json pnpm-lock.yaml apps/app/server/lib/notifications/expo-push.ts apps/app/server/lib/notifications/expo-push.test.ts apps/app/server/plugins/expo-push.ts apps/app/server/routes/api/devices/push.post.ts apps/app/server/routes/api/devices/push.delete.ts
git commit -m "feat(app): expo push channel and device push token routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Server — first-batch notification

**Files:**
- Create: `apps/app/server/lib/ingest/first-batch.ts`
- Modify: `apps/app/server/routes/api/ingest/v1/batches.post.ts` (call after `touchDevice`)
- Test: `apps/app/server/lib/ingest/first-batch.test.ts`

**Interfaces:**
- Consumes: `notify(input, meta)` from `@agent-native/core/notifications`; `schema.ingestBatches`, `schema.healthSources`; `IngestResult` (`{ duplicate, sourceId, stored }`).
- Produces: `notifyFirstBatch(identity: DeviceIdentity, result: IngestResult, batch: { daily: { date: string }[] }): Promise<boolean>` — returns `true` when it sent the "Your phone sent N days of health data" notification (idempotencyKey `first-batch:<sourceId>`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/server/lib/ingest/first-batch.test.ts
import { randomUUID } from "node:crypto";

import { ingestBatchSchema } from "@vitls/health-ingest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { setupTestDb } from "../../test/db";
import { createPairing, redeemPairing } from "./devices";
import { notifyFirstBatch } from "./first-batch";
import { ingestBatch } from "./ingest";

const notified: { title: string; idempotencyKey?: string }[] = [];
vi.mock("@agent-native/core/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notify: async (input: { title: string; idempotencyKey?: string }) => (notified.push(input), undefined),
}));

const owner = { userEmail: "ben@example.com", orgId: "org_ben" };
const FREE = { intraday: false, rawRetentionDays: 30 };
const batchFor = (days: string[]) =>
  ingestBatchSchema.parse({
    batchId: randomUUID(),
    sentAt: new Date().toISOString(),
    source: { provider: "health_connect", via: "companion" },
    daily: days.map((date) => ({ externalId: `steps:${date}`, date, metric: "steps", value: 1000, unit: "count" })),
  });

describe("first batch notification", () => {
  beforeAll(setupTestDb);

  it("fires once per source with the number of days, then never again", async () => {
    const { code } = await createPairing(owner);
    const { deviceId } = await redeemPairing(code, { platform: "android" });
    const identity = { ...owner, deviceId, scope: "ingest:write" };

    const first = batchFor(["2026-10-01", "2026-10-02", "2026-10-03"]);
    const r1 = await ingestBatch({ identity, batch: first, entitlements: FREE });
    expect(await notifyFirstBatch(identity, r1, first)).toBe(true);
    expect(notified[0]).toMatchObject({ title: expect.stringContaining("3 days"), idempotencyKey: `first-batch:${r1.sourceId}` });

    const dup = await ingestBatch({ identity, batch: first, entitlements: FREE });
    expect(dup.duplicate).toBe(true);
    expect(await notifyFirstBatch(identity, dup, first)).toBe(false);

    const second = batchFor(["2026-10-04"]);
    const r2 = await ingestBatch({ identity, batch: second, entitlements: FREE });
    expect(await notifyFirstBatch(identity, r2, second)).toBe(false);
    expect(notified).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/lib/ingest/first-batch.test.ts`
Expected: FAIL with "Cannot find module './first-batch'"

- [ ] **Step 3: Implement**

```ts
// apps/app/server/lib/ingest/first-batch.ts
/** Tells the user (push + in-app) that their phone's first health batch landed; the coach then continues onboarding. */
import { notify } from "@agent-native/core/notifications";
import { and, count, eq } from "drizzle-orm";

import { getDb, schema } from "../../db";
import type { DeviceIdentity } from "./devices";
import type { IngestResult } from "./ingest";

export async function notifyFirstBatch(identity: DeviceIdentity, result: IngestResult, batch: { daily: { date: string }[] }): Promise<boolean> {
  if (result.duplicate) return false;
  const [row] = await getDb()
    .select({ n: count() })
    .from(schema.ingestBatches)
    .where(and(eq(schema.ingestBatches.ownerEmail, identity.userEmail), eq(schema.ingestBatches.sourceId, result.sourceId)));
  if ((row?.n ?? 0) !== 1) return false;
  const days = new Set(batch.daily.map((d) => d.date)).size;
  await notify(
    {
      severity: "info",
      title: `Your phone sent ${days} ${days === 1 ? "day" : "days"} of health data`,
      body: "Open the coach to continue.",
      metadata: { url: "/home" },
      idempotencyKey: `first-batch:${result.sourceId}`,
    },
    { owner: identity.userEmail },
  );
  return true;
}
```

In `batches.post.ts`, after `await touchDevice(identity.deviceId, identity);` add
`await notifyFirstBatch(identity, result, batch);` with the import `import { notifyFirstBatch } from "../../../../lib/ingest/first-batch";`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @vitls/app test -- server/lib/ingest`
Expected: PASS, including the existing ingest/devices/http/manual suites.

- [ ] **Step 5: Commit**

```bash
git add apps/app/server/lib/ingest/first-batch.ts apps/app/server/lib/ingest/first-batch.test.ts apps/app/server/routes/api/ingest/v1/batches.post.ts
git commit -m "feat(app): notify the user once when a device's first batch arrives

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Server — `<devices>` block and shell rule in the coach context

**Files:**
- Create: `apps/app/server/lib/coach/devices-context.ts`
- Create: `apps/app/shared/shell.ts`
- Modify: `apps/app/server/plugins/agent-chat.ts:32-49` (`coachContext`)
- Test: `apps/app/server/lib/coach/devices-context.test.ts`, `apps/app/shared/shell.test.ts`

**Interfaces:**
- Consumes: `listDevices(owner)` from `server/lib/ingest/devices.ts` (returns `{ id, label, platform, createdAt, lastUsedAt?, revokedAt? }[]`; check the exact field names in the file and use them); `getToday(owner)` from Task 1 (`lastBatchAt`, `missing`).
- Produces:
  ```ts
  // shared/shell.ts
  export const SHELL_UA = "VITLSCompanion/";
  export function isShellUserAgent(ua: string | undefined | null): boolean;   // ua includes SHELL_UA
  export function isShell(): boolean;                                         // client: typeof window !== "undefined" && window.vitlsShell?.v === 1
  // server/lib/coach/devices-context.ts
  export async function devicesContext(owner: OwnerScope): Promise<string>;   // "<devices>…</devices>" block
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/app/shared/shell.test.ts
import { describe, expect, it } from "vitest";

import { isShell, isShellUserAgent } from "./shell";

describe("shell detection", () => {
  it("recognises the companion user agent", () => {
    expect(isShellUserAgent("Mozilla/5.0 (Linux; Android 15) VITLSCompanion/1.0.0")).toBe(true);
    expect(isShellUserAgent("Mozilla/5.0 Safari")).toBe(false);
    expect(isShellUserAgent(undefined)).toBe(false);
  });
  it("is false outside a browser", () => {
    expect(isShell()).toBe(false);
  });
});
```

```ts
// apps/app/server/lib/coach/devices-context.test.ts
import { beforeAll, describe, expect, it } from "vitest";

import { setupTestDb } from "../../test/db";
import { createPairing, redeemPairing } from "../ingest/devices";
import { devicesContext } from "./devices-context";

const owner = { userEmail: "dev@example.com", orgId: "org_dev" };

describe("devices context block", () => {
  beforeAll(setupTestDb);

  it("says no device is paired yet", async () => {
    expect(await devicesContext(owner)).toContain("no device paired");
  });

  it("lists paired devices, last batch and missing metrics", async () => {
    const { code } = await createPairing(owner);
    await redeemPairing(code, { platform: "android", model: "Pixel 8" });
    const block = await devicesContext(owner);
    expect(block).toMatch(/<devices>[\s\S]*android[\s\S]*<\/devices>/);
    expect(block).toContain("last batch: never");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @vitls/app test -- shared/shell.test.ts server/lib/coach/devices-context.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement**

```ts
// apps/app/shared/shell.ts
/** "Shell mode": the PWA runs inside the companion app's WebView. No prices, plans or purchase links are shown there. */
export const SHELL_UA = "VITLSCompanion/";

declare global {
  interface Window {
    vitlsShell?: { v: number; platform: string };
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

export function isShellUserAgent(ua: string | undefined | null): boolean {
  return typeof ua === "string" && ua.includes(SHELL_UA);
}

export function isShell(): boolean {
  return typeof window !== "undefined" && window.vitlsShell?.v === 1;
}
```

```ts
// apps/app/server/lib/coach/devices-context.ts
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
```

`listDevices` (`server/lib/ingest/devices.ts:131-147`) returns `{ id, label, platform, tokenPrefix, createdAt, lastUsedAt, revokedAt }`, so the field names above are exact.

In `agent-chat.ts` change `coachContext` to:

```ts
async function coachContext(event: unknown, owner: string): Promise<string | null> {
  if (!owner) return null;
  const { profile, onboarded, readoutScheduled } = await getCoachProfile(owner);
  const persona = profile.persona ? PERSONAS[profile.persona] : undefined;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile.timezone ?? "UTC" });
  const orgId = (await getOrgContext(event as Parameters<typeof getOrgContext>[0])).orgId ?? null;
  const ua = (event as { headers?: Headers; node?: { req?: { headers?: Record<string, string | undefined> } } })?.node?.req?.headers?.["user-agent"];
  return [
    "<coach-profile>",
    /* …existing lines unchanged… */
    "</coach-profile>",
    await devicesContext({ userEmail: owner, orgId }),
    ...(isShellUserAgent(ua) ? ["<client>mobile companion shell: never mention prices, plans, subscriptions or how to buy; everything the user sees here is free</client>"] : []),
  ].join("\n");
}
```

Add imports `import { devicesContext } from "../lib/coach/devices-context";` and `import { isShellUserAgent } from "../../shared/shell";`. If `event` is not an h3 event in this framework version (check the `extraContext` type in `node_modules/@agent-native/core/dist/chat/*.d.ts`), read the user agent with `getHeader(event, "user-agent")` from h3 instead.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @vitls/app test -- shared/shell.test.ts server/lib/coach` then `pnpm --filter @vitls/app exec tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/shared/shell.ts apps/app/shared/shell.test.ts apps/app/server/lib/coach/devices-context.ts apps/app/server/lib/coach/devices-context.test.ts apps/app/server/plugins/agent-chat.ts
git commit -m "feat(app): devices block and shell rule in the coach context

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: PWA — shell bridge (auto-pair, sync status, hidden pricing hook)

**Files:**
- Create: `apps/app/app/lib/shell-bridge.ts`
- Create: `apps/app/app/components/ShellBridge.tsx`
- Create: `apps/app/app/components/settings/PhoneSyncSetting.tsx`
- Modify: `apps/app/app/root.tsx` (mount `<ShellBridge />` once inside the authenticated layout)
- Modify: `apps/app/app/routes/settings.tsx` (render `<PhoneSyncSetting />` next to `PushNotificationsSetting`)
- Test: `apps/app/app/lib/shell-bridge.test.ts`

**Interfaces:**
- Consumes: `callAction(name, args)` from `@agent-native/core/client/hooks`; `create-device-pairing` action (returns `{ code: string, expiresAt: string }`; confirm the field name in `actions/create-device-pairing.ts`); `isShell()` from Task 7.
- Produces:
  ```ts
  export type BridgeOut = { v: 1; type: "pair"; code: string } | { v: 1; type: "sync-now" };
  export type BridgeIn = { v: 1; type: "sync-status"; lastSyncAt?: string; lastError?: string; deviceId?: string };
  export function postToShell(message: BridgeOut): void;                 // no-op outside the shell
  export function parseFromShell(raw: unknown): BridgeIn | null;        // null for unknown v/type or malformed JSON
  export function onShellMessage(handler: (m: BridgeIn) => void): () => void;  // listens to window "message" + document "message" (Android)
  ```
  The native layer posts messages with `window.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }))`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/app/lib/shell-bridge.test.ts
import { describe, expect, it } from "vitest";

import { parseFromShell } from "./shell-bridge";

describe("shell bridge parsing", () => {
  it("accepts a v1 sync-status", () => {
    expect(parseFromShell(JSON.stringify({ v: 1, type: "sync-status", lastSyncAt: "2026-10-10T07:00:00Z" }))).toEqual({
      v: 1,
      type: "sync-status",
      lastSyncAt: "2026-10-10T07:00:00Z",
    });
  });
  it("ignores other versions, unknown types and junk", () => {
    expect(parseFromShell(JSON.stringify({ v: 2, type: "sync-status" }))).toBeNull();
    expect(parseFromShell(JSON.stringify({ v: 1, type: "reboot" }))).toBeNull();
    expect(parseFromShell("{not json")).toBeNull();
    expect(parseFromShell(42)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- app/lib/shell-bridge.test.ts`
Expected: FAIL with "Cannot find module './shell-bridge'"

- [ ] **Step 3: Implement**

```ts
// apps/app/app/lib/shell-bridge.ts
/** postMessage bridge between the PWA and the companion WebView. Three message types, versioned, unknown ones dropped. */
import { z } from "zod";

import { isShell } from "../../shared/shell";

export type BridgeOut = { v: 1; type: "pair"; code: string } | { v: 1; type: "sync-now" };
const bridgeIn = z.object({ v: z.literal(1), type: z.literal("sync-status"), lastSyncAt: z.string().optional(), lastError: z.string().optional(), deviceId: z.string().optional() });
export type BridgeIn = z.infer<typeof bridgeIn>;

export function postToShell(message: BridgeOut): void {
  if (!isShell()) return;
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

export function parseFromShell(raw: unknown): BridgeIn | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = bridgeIn.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function onShellMessage(handler: (m: BridgeIn) => void): () => void {
  const listener = (e: Event) => {
    const m = parseFromShell((e as MessageEvent).data);
    if (m) handler(m);
  };
  window.addEventListener("message", listener);
  document.addEventListener("message", listener);
  return () => {
    window.removeEventListener("message", listener);
    document.removeEventListener("message", listener);
  };
}
```

```tsx
// apps/app/app/components/ShellBridge.tsx
import { callAction } from "@agent-native/core/client/hooks";
import { useEffect } from "react";

import { isShell } from "../../shared/shell";
import { postToShell } from "@/lib/shell-bridge";

const PAIRED_FLAG = "vitls-shell-paired";

/** In the companion WebView: pair the phone once, silently, right after sign-in (spec §3 step 4). Renders nothing. */
export function ShellBridge() {
  useEffect(() => {
    if (!isShell()) return;
    let paired = false;
    try {
      paired = sessionStorage.getItem(PAIRED_FLAG) === "1";
    } catch {}
    if (paired) return;
    void (async () => {
      const { code } = (await callAction("create-device-pairing", {})) as { code: string };
      postToShell({ v: 1, type: "pair", code });
      try {
        sessionStorage.setItem(PAIRED_FLAG, "1");
      } catch {}
    })();
  }, []);
  return null;
}
```

```tsx
// apps/app/app/components/settings/PhoneSyncSetting.tsx
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { onShellMessage, postToShell, type BridgeIn } from "@/lib/shell-bridge";
import { isShell } from "../../../shared/shell";

/** Settings → This phone (shell only): sync status from the companion and a Sync now button over the bridge (spec §5). */
export function PhoneSyncSetting() {
  const [status, setStatus] = useState<BridgeIn>();
  useEffect(() => (isShell() ? onShellMessage(setStatus) : undefined), []);
  if (!isShell()) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm">Device: {status?.deviceId ?? "pairing…"}</p>
      <p className="text-sm">Last sync: {status?.lastSyncAt ?? "never"}</p>
      {status?.lastError ? <p className="text-sm text-destructive">{status.lastError}</p> : null}
      <Button onClick={() => postToShell({ v: 1, type: "sync-now" })} disabled={!status?.deviceId}>
        Sync now
      </Button>
    </div>
  );
}
```

Mount `<ShellBridge />` in `root.tsx` next to where the authenticated app shell renders (the component is safe to mount everywhere: it returns early when `isShell()` is false). Native replies to a second `pair` on a fresh WebView session with "already paired" handling (Task 11), so the sessionStorage flag is a courtesy, not a guarantee.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @vitls/app test -- app/lib/shell-bridge.test.ts` and `pnpm --filter @vitls/app exec tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/app/app/lib/shell-bridge.ts apps/app/app/lib/shell-bridge.test.ts apps/app/app/components/ShellBridge.tsx apps/app/app/components/settings/PhoneSyncSetting.tsx apps/app/app/root.tsx apps/app/app/routes/settings.tsx
git commit -m "feat(app): shell bridge — auto-pair the companion, phone sync card in settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: PWA — Universal Links / App Links files

**Files:**
- Create: `apps/app/public/.well-known/apple-app-site-association` (no extension, JSON)
- Create: `apps/app/public/.well-known/assetlinks.json`
- Modify: `apps/app/.env.example` (document `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256` placeholders)
- Test: `apps/app/server/routes/well-known.test.ts` (if `public/` files are served statically by the framework, this test only asserts the files parse and name the right paths)

**Interfaces:**
- Produces: both files served at `https://<pwa-domain>/.well-known/…` with `content-type: application/json`. The magic-link verify path is `/_agent-native/auth/ba/magic-link/verify` (Better Auth default mounted under `/_agent-native/auth/ba`; confirm by requesting a magic link locally and reading the URL in Mailpit at http://localhost:8027).

- [ ] **Step 1: Write the failing test**

```ts
// apps/app/server/routes/well-known.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const pub = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "../../public/.well-known", f), "utf8"));

describe("universal / app link files", () => {
  it("AASA covers the magic-link verify path and the pair path", () => {
    const aasa = pub("apple-app-site-association");
    const detail = aasa.applinks.details[0];
    expect(detail.appIDs[0]).toMatch(/\.ai\.vitls\.companion$/);
    expect(detail.components.map((c: { "/": string }) => c["/"])).toEqual(["/_agent-native/auth/ba/magic-link/verify*", "/pair*"]);
  });
  it("assetlinks names the companion package", () => {
    const [link] = pub("assetlinks.json");
    expect(link.target.package_name).toBe("ai.vitls.companion");
    expect(link.relation).toContain("delegate_permission/common.handle_all_urls");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @vitls/app test -- server/routes/well-known.test.ts`
Expected: FAIL with ENOENT

- [ ] **Step 3: Create the files**

```json
// apps/app/public/.well-known/apple-app-site-association
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.ai.vitls.companion"],
        "components": [
          { "/": "/_agent-native/auth/ba/magic-link/verify*", "comment": "magic-link sign-in opens the companion" },
          { "/": "/pair*", "comment": "pairing deep link" }
        ]
      }
    ]
  }
}
```

```json
// apps/app/public/.well-known/assetlinks.json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": { "namespace": "android_app", "package_name": "ai.vitls.companion", "sha256_cert_fingerprints": ["REPLACE_WITH_RELEASE_CERT_SHA256"] }
  }
]
```

`TEAMID` and the certificate fingerprint are deploy-time values; add to `.env.example`:

```
# Universal / App Links for the companion (public/.well-known): replace TEAMID in apple-app-site-association and the
# sha256 fingerprint in assetlinks.json at deploy time (keytool -list -v -keystore <release.keystore>).
```

Confirm the framework serves `public/.well-known/apple-app-site-association` without an extension and with a JSON content type: run `PORT=8081 pnpm exec agent-native dev` and `curl -sI http://localhost:8081/.well-known/apple-app-site-association`. If the content type is wrong, add a Nitro route rule in `nitro.config`/`agent-native` config for `/.well-known/**` with `headers: { "content-type": "application/json" }` (see the installed framework docs under `node_modules/@agent-native/core/docs/content/deployment.mdx`).

- [ ] **Step 4: Run test**

Run: `pnpm --filter @vitls/app test -- server/routes/well-known.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/app/public/.well-known apps/app/.env.example apps/app/server/routes/well-known.test.ts
git commit -m "feat(app): universal/app link files for the companion sign-in

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Companion — API client for the device routes

**Files:**
- Create: `apps/companion/src/api.ts`
- Modify: `apps/companion/src/sync.ts` (export `post`, add `request`, add `expoToken` to `State`, call `DELETE /api/devices/push` in `disconnect`)
- Test: `apps/companion/src/api.test.ts` (vitest in the companion; add `"test": "vitest --run"` and `vitest` devDependency to `apps/companion/package.json`)

**Interfaces:**
- Consumes: `State`, `loadState`, `saveState` (export it) from `src/sync.ts`.
- Produces:
  ```ts
  // src/sync.ts additions
  export interface State { server; token; deviceId; cursor?; lastSyncAt?; lastError?; expoToken?: string }
  export async function request<T>(state: State, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T>;
  // throws Error("unauthorized") on 401 so screens can reset to login
  // src/api.ts
  export interface TodayView { date: string; readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null; metrics: { steps?: number; sleep_min?: number; resting_hr?: number }; lastBatchAt: string | null; missing: string[] }
  export const getToday = (state: State) => request<TodayView>(state, "GET", "/api/devices/today");
  export const quickLog = (state: State, entries: { metric: string; value: number; unit?: string; date: string }[]) => request<{ stored: number }>(state, "POST", "/api/devices/log", { entries });
  export const registerPush = (state: State, expoToken: string, label?: string) => request<{ ok: true }>(state, "POST", "/api/devices/push", { expoToken, label });
  export const unregisterPush = (state: State, expoToken: string) => request<{ ok: true }>(state, "DELETE", "/api/devices/push", { expoToken });
  export const MISSING_HINTS: Record<string, string>;   // metric key → one-line "how to enable" hint, e.g. vo2max → "Garmin: enable VO2max export to Health Connect in Garmin Connect › Settings › Health Connect"
  ```

- [ ] **Step 1: Add vitest and write the failing test**

Run: `cd apps/companion && npx expo install vitest --dev` (or `pnpm add -D vitest` inside `apps/companion`), then add `"test": "vitest --run"` to its scripts.

```ts
// apps/companion/src/api.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "1.0.0" } } }));
vi.mock("expo-device", () => ({ modelName: "Test", osVersion: "1" }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-background-task", () => ({ registerTaskAsync: async () => {}, unregisterTaskAsync: async () => {}, BackgroundTaskResult: { Success: 1, Failed: 2 } }));
vi.mock("expo-task-manager", () => ({ defineTask: () => {} }));
vi.mock("./health", () => ({ provider: "health_connect", read: async () => ({}), requestAccess: async () => true }));

const { getToday, quickLog } = await import("./api");
const state = { server: "http://srv", token: "vdt_x", deviceId: "d1" };

describe("device api client", () => {
  it("sends the bearer token and returns json", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ date: "2026-10-10", readout: null, metrics: {}, lastBatchAt: null, missing: [] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getToday(state)).date).toBe("2026-10-10");
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://srv/api/devices/today");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer vdt_x");
  });
  it("throws 'unauthorized' on 401", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Invalid or revoked device token" }), { status: 401 }));
    await expect(quickLog(state, [{ metric: "weight", value: 80, date: "2026-10-10" }])).rejects.toThrow("unauthorized");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/companion && pnpm test`
Expected: FAIL with "Cannot find module './api'"

- [ ] **Step 3: Implement**

In `src/sync.ts`: add `expoToken?: string` to `State`; export `saveState`; replace `post` with

```ts
export async function request<T>(state: Pick<State, "server" | "token">, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${state.server}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${state.token}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new Error("unauthorized");
  if (!res.ok) throw new Error(String(json.error ?? `HTTP ${res.status}`));
  return json as T;
}
```

and keep `post(server, path, body, token?)` only for `pair` (redeem has no token), or express `pair` through `fetch` directly and delete `post`. In `sync()` replace `await post(state.server, "/api/ingest/v1/batches", batch, state.token)` with `await request(state, "POST", "/api/ingest/v1/batches", batch)`. In `disconnect`, before deleting the key: `const s = await loadState(); if (s?.expoToken) await request(s, "DELETE", "/api/devices/push", { expoToken: s.expoToken }).catch(() => {});`.

```ts
// apps/companion/src/api.ts
/** The companion's three device-token endpoints besides ingest (spec §2, §6). */
import { request, type State } from "./sync";

export interface TodayView {
  date: string;
  readout: { greeting?: string; directive: string; highlights: { metric: string; note: string }[] } | null;
  metrics: { steps?: number; sleep_min?: number; resting_hr?: number };
  lastBatchAt: string | null;
  missing: string[];
}

export const getToday = (state: State) => request<TodayView>(state, "GET", "/api/devices/today");
export const quickLog = (state: State, entries: { metric: string; value: number; unit?: string; date: string }[]) =>
  request<{ stored: number }>(state, "POST", "/api/devices/log", { entries });
export const registerPush = (state: State, expoToken: string, label?: string) =>
  request<{ ok: true }>(state, "POST", "/api/devices/push", { expoToken, label });
export const unregisterPush = (state: State, expoToken: string) => request<{ ok: true }>(state, "DELETE", "/api/devices/push", { expoToken });

/** One line per goal metric the server reports as missing (TodayView.missing). */
export const MISSING_HINTS: Record<string, string> = {
  vo2max: "VO2max: Garmin Connect › Settings › Health Connect › enable VO2max; Apple Watch writes it automatically.",
  hrv_rmssd_night: "HRV: Garmin does not export HRV to Health Connect; Apple Watch and Oura do.",
  sleep_score: "Sleep score stays inside the vendor app; sleep stages are synced instead.",
  training_readiness: "Training readiness is Garmin-only and is not exported.",
  intensity_minutes: "Intensity minutes are not exported by Garmin; workouts are.",
  body_fat_pct: "Body fat: a smart scale app that writes to Health Connect / Apple Health.",
  muscle_mass: "Muscle mass: a smart scale app that writes lean mass to Health Connect / Apple Health.",
};
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd apps/companion && pnpm test && npx tsc --noEmit -p .`
Expected: PASS (2 tests), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add apps/companion/package.json pnpm-lock.yaml apps/companion/src/api.ts apps/companion/src/api.test.ts apps/companion/src/sync.ts
git commit -m "feat(companion): device api client (today, quick log, push token)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Companion — tabs, login, Coach WebView with bridge, Settings

**Files:**
- Modify: `apps/companion/package.json` (add `react-native-webview`, `expo-notifications`)
- Modify: `apps/companion/app.json` (plugin `expo-notifications`; `ios.associatedDomains: ["applinks:<pwa-domain>"]`; `android.intentFilters` for `https://<pwa-domain>/_agent-native/auth/ba/magic-link/verify` and `/pair` with `autoVerify: true`)
- Create: `apps/companion/src/bridge.ts`
- Create: `apps/companion/src/app/(tabs)/_layout.tsx`, `apps/companion/src/app/(tabs)/index.tsx` (Today, filled in Task 12), `apps/companion/src/app/(tabs)/coach.tsx`, `apps/companion/src/app/(tabs)/settings.tsx`
- Create: `apps/companion/src/app/login.tsx`
- Modify: `apps/companion/src/app/_layout.tsx` (Stack: `(tabs)`, `login`, `pair` kept as modal fallback)
- Delete: `apps/companion/src/app/index.tsx` (replaced by the tab)
- Test: `apps/companion/src/bridge.test.ts`

**Interfaces:**
- Consumes: `pair(server, code)`, `sync(state)`, `loadState`, `disconnect` from `src/sync.ts`; `registerPush` from Task 10.
- Produces:
  ```ts
  // src/bridge.ts
  export type FromWeb = { v: 1; type: "pair"; code: string } | { v: 1; type: "sync-now" };
  export type ToWeb = { v: 1; type: "sync-status"; lastSyncAt?: string; lastError?: string; deviceId?: string };
  export function parseFromWeb(raw: string): FromWeb | null;
  export const injectToWeb = (m: ToWeb) => `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(JSON.stringify(m))}}));true;`;
  export const SHELL_INIT = (platform: string) => `window.vitlsShell={v:1,platform:${JSON.stringify(platform)}};true;`;
  ```
  Server URL: `process.env.EXPO_PUBLIC_VITLS_SERVER` (required; the login screen shows an input only when it is unset, dev builds).

- [ ] **Step 1: Install packages**

Run: `cd apps/companion && npx expo install react-native-webview expo-notifications`
Expected: both in `package.json` with SDK-57-compatible versions.

- [ ] **Step 2: Write the failing bridge test**

```ts
// apps/companion/src/bridge.test.ts
import { describe, expect, it } from "vitest";

import { injectToWeb, parseFromWeb } from "./bridge";

describe("native side of the bridge", () => {
  it("parses v1 pair and sync-now, drops the rest", () => {
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM" }))).toEqual({ v: 1, type: "pair", code: "ABCD-EFGH-JKLM" });
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "sync-now" }))).toEqual({ v: 1, type: "sync-now" });
    expect(parseFromWeb(JSON.stringify({ v: 2, type: "pair", code: "x" }))).toBeNull();
    expect(parseFromWeb(JSON.stringify({ v: 1, type: "format-disk" }))).toBeNull();
    expect(parseFromWeb("nope")).toBeNull();
  });
  it("serialises sync-status as a MessageEvent dispatch", () => {
    const js = injectToWeb({ v: 1, type: "sync-status", lastSyncAt: "t" });
    expect(js).toContain('"type\\":\\"sync-status\\"');
    expect(js.endsWith("true;")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/companion && pnpm test`
Expected: FAIL with "Cannot find module './bridge'"

- [ ] **Step 4: Implement the bridge**

```ts
// apps/companion/src/bridge.ts
/** Native side of the WebView bridge (spec §4): three message types, versioned, unknown ones dropped. */
export type FromWeb = { v: 1; type: "pair"; code: string } | { v: 1; type: "sync-now" };
export type ToWeb = { v: 1; type: "sync-status"; lastSyncAt?: string; lastError?: string; deviceId?: string };

export function parseFromWeb(raw: string): FromWeb | null {
  try {
    const m = JSON.parse(raw) as { v?: unknown; type?: unknown; code?: unknown };
    if (m?.v !== 1) return null;
    if (m.type === "pair" && typeof m.code === "string" && m.code.length >= 12 && m.code.length <= 20) return { v: 1, type: "pair", code: m.code };
    if (m.type === "sync-now") return { v: 1, type: "sync-now" };
    return null;
  } catch {
    return null;
  }
}

export const injectToWeb = (m: ToWeb) => `window.dispatchEvent(new MessageEvent("message",{data:${JSON.stringify(JSON.stringify(m))}}));true;`;
export const SHELL_INIT = (platform: string) => `window.vitlsShell={v:1,platform:${JSON.stringify(platform)}};true;`;
```

- [ ] **Step 5: Screens**

```tsx
// apps/companion/src/app/_layout.tsx
import { Stack } from "expo-router";

import "@/sync"; // defines the background sync task before any route renders (also on headless launches)

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ headerShown: true, title: "Sign in" }} />
      <Stack.Screen name="pair" options={{ headerShown: true, title: "Enter pairing code", presentation: "modal" }} />
    </Stack>
  );
}
```

```tsx
// apps/companion/src/app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="coach" options={{ title: "Coach" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
```

```tsx
// apps/companion/src/app/login.tsx
import { router } from "expo-router";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

export const SERVER = process.env.EXPO_PUBLIC_VITLS_SERVER ?? "";

/** Asks the server for a magic link; the link opens this app (Universal/App Link) and lands in the Coach tab (spec §3). */
export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async () => {
    try {
      const res = await fetch(`${SERVER}/_agent-native/auth/magic-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View style={styles.screen}>
      {sent ? (
        <Text style={styles.body}>Check your e-mail and tap the sign-in link. It opens this app.</Text>
      ) : (
        <>
          <Text style={styles.body}>Sign in with the e-mail you use for VITLS.</Text>
          <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Send sign-in link" onPress={submit} disabled={!email.includes("@")} />
        </>
      )}
      <Button title="I have a pairing code" onPress={() => router.push("/pair")} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  body: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 12, fontSize: 16 },
  error: { color: "#c0392b" },
});
```

Check the request body the framework's `POST /_agent-native/auth/magic-link` expects (`node_modules/@agent-native/core/docs/content/authentication.mdx` and the route source under `node_modules/@agent-native/core/dist/auth/`); it may need `callbackURL`. If so, pass `callbackURL: "/home"`.

```tsx
// apps/companion/src/app/(tabs)/coach.tsx
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Platform } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { injectToWeb, parseFromWeb, SHELL_INIT } from "@/bridge";
import { loadState, pair, sync, type State } from "@/sync";
import { SERVER } from "../login";

const UA_SUFFIX = ` VITLSCompanion/${Constants.expoConfig?.version ?? "0"}`;

/** The PWA. The initial URL is the incoming link (magic link / push url) when there is one, else /home. */
export default function Coach() {
  const params = useLocalSearchParams<{ url?: string }>();
  const incoming = Linking.useLinkingURL();
  const web = useRef<WebView>(null);
  const [state, setState] = useState<State>();
  const [canGoBack, setCanGoBack] = useState(false);
  useFocusEffect(useCallback(() => void loadState().then(setState), []));

  const start = (() => {
    const link = params.url ?? incoming;
    if (link?.startsWith(SERVER)) return link;                                  // magic-link verify or push url on our domain
    if (link?.startsWith("vitls://open")) return `${SERVER}${new URL(link).searchParams.get("url") ?? "/home"}`;
    return `${SERVER}/home`;
  })();

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (canGoBack ? (web.current?.goBack(), true) : false));
    return () => sub.remove();
  }, [canGoBack]);

  const push = (s: State | undefined) => web.current?.injectJavaScript(injectToWeb({ v: 1, type: "sync-status", lastSyncAt: s?.lastSyncAt, lastError: s?.lastError, deviceId: s?.deviceId }));

  const onMessage = async (e: WebViewMessageEvent) => {
    const m = parseFromWeb(e.nativeEvent.data);
    if (!m) return;
    if (m.type === "pair") {
      if (state) return push(state);                     // already paired: just report status
      const s = await pair(SERVER, m.code);
      setState(s);
      push(s);
    } else if (m.type === "sync-now" && state) {
      const s = await sync(state);
      setState(s);
      push(s);
    }
  };

  return (
    <WebView
      ref={web}
      source={{ uri: start }}
      applicationNameForUserAgent={UA_SUFFIX.trim()}
      injectedJavaScriptBeforeContentLoaded={SHELL_INIT(Platform.OS)}
      onMessage={onMessage}
      onLoadEnd={() => push(state)}
      onNavigationStateChange={(nav) => setCanGoBack(nav.canGoBack)}
      onShouldStartLoadWithRequest={(req) => (req.url.startsWith(SERVER) ? true : (void Linking.openURL(req.url), false))}
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      allowsBackForwardNavigationGestures
    />
  );
}
```

`applicationNameForUserAgent` appends ` VITLSCompanion/<version>` to the default UA on both platforms (verify with `curl`-style logging on the dev server: the `user-agent` header must contain `VITLSCompanion/`).

```tsx
// apps/companion/src/app/(tabs)/settings.tsx
import * as BackgroundTask from "expo-background-task";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Button, Linking, StyleSheet, Text, View } from "react-native";

import { disconnect, loadState, sync, type State } from "@/sync";
import { SERVER } from "../login";

export default function Settings() {
  const [state, setState] = useState<State | null>();
  const [busy, setBusy] = useState(false);
  useFocusEffect(useCallback(() => void loadState().then((s) => setState(s ?? null)), []));
  if (state === undefined) return null;
  if (state === null)
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>This phone is not connected to VITLS yet.</Text>
        <Button title="Sign in" onPress={() => router.push("/login")} />
      </View>
    );
  const run = async () => {
    setBusy(true);
    setState(await sync(state));
    setBusy(false);
  };
  return (
    <View style={styles.screen}>
      <Text style={styles.body}>Server: {state.server}</Text>
      <Text style={styles.body}>Device: {state.deviceId}</Text>
      <Text style={styles.body}>Last sync: {state.lastSyncAt ?? "never"} (also every ~15 min in the background)</Text>
      {state.lastError ? <Text style={[styles.body, styles.error]}>Last error: {state.lastError}</Text> : null}
      <Button title={busy ? "Syncing…" : "Sync now"} onPress={run} disabled={busy} />
      {__DEV__ ? <Button title="Run background task now (dev)" onPress={() => void BackgroundTask.triggerTaskWorkerForTestingAsync()} /> : null}
      <Button title="Enter pairing code" onPress={() => router.push("/pair")} />
      <Button title="Privacy policy" onPress={() => void Linking.openURL(`${SERVER}/privacy`)} />
      <Text style={styles.small}>VITLS is a coach, not a doctor. Nothing here is medical advice.</Text>
      <Button title="Disconnect" color="#c0392b" onPress={() => disconnect().then(() => setState(null))} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12, justifyContent: "center" },
  body: { fontSize: 16 },
  small: { fontSize: 12, color: "#666" },
  error: { color: "#c0392b" },
});
```

Delete `src/app/index.tsx`. Keep `src/app/pair.tsx` but change its `router.replace("/")` to `router.replace("/(tabs)")` and let the server field default to `SERVER`.

- [ ] **Step 6: app.json**

Add to `plugins`: `"expo-notifications"`. Add `"ios": { …, "associatedDomains": ["applinks:PWA_DOMAIN"] }` and

```json
"android": {
  "...": "...",
  "intentFilters": [
    {
      "action": "VIEW",
      "autoVerify": true,
      "data": [
        { "scheme": "https", "host": "PWA_DOMAIN", "pathPrefix": "/_agent-native/auth/ba/magic-link/verify" },
        { "scheme": "https", "host": "PWA_DOMAIN", "pathPrefix": "/pair" }
      ],
      "category": ["BROWSABLE", "DEFAULT"]
    }
  ]
}
```

`PWA_DOMAIN` is a placeholder until production has a domain; for the LAN test the magic link is opened by pasting it into the Coach tab (dev only: add a `TextInput` "Open URL" above the WebView when `__DEV__`, which sets `params.url`).

- [ ] **Step 7: Typecheck, run tests, build**

Run: `cd apps/companion && pnpm test && npx tsc --noEmit -p . && npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleDebug`
Expected: tests PASS, tsc clean, `BUILD SUCCESSFUL`, manifest contains the intent filter.

- [ ] **Step 8: On-device check (Android dev build, Metro on 8085)**

Install the APK, open the app: Settings shows "not connected"; Sign in → magic link arrives in Mailpit (http://localhost:8027); paste the link into the dev "Open URL" box → the WebView lands signed in on `/home`; within seconds Settings shows a device id (auto-pair worked) and the server has a new row in `device_tokens`. In the WebView open Settings: the "This phone" card shows the device id; tap its Sync now → the card's Last sync updates (the `sync-status` reply).

- [ ] **Step 9: Commit**

```bash
git add apps/companion
git commit -m "feat(companion): tabs, magic-link login, coach webview with bridge, settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Companion — Today screen, quick log, push registration, notification tap

**Files:**
- Create: `apps/companion/src/app/(tabs)/index.tsx`
- Create: `apps/companion/src/push.ts`
- Modify: `apps/companion/src/app/(tabs)/_layout.tsx` (mount `usePushRouting()`)
- Modify: `apps/companion/src/sync.ts` (`pair` registers push after redeem; keep failures non-fatal)
- Test: `apps/companion/src/today.test.ts` (pure formatting helpers)

**Interfaces:**
- Consumes: `getToday`, `quickLog`, `registerPush`, `MISSING_HINTS`, `TodayView` from Task 10; `loadState`, `saveState`, `sync` from `src/sync.ts`.
- Produces:
  ```ts
  // src/push.ts
  export async function ensurePushToken(state: State): Promise<State>;   // asks permission, gets Expo token, POSTs it once, stores expoToken in State
  export function usePushRouting(): void;                                  // on notification tap, router.push({ pathname: "/(tabs)/coach", params: { url: data.url } })
  // src/today.ts (helpers tested below)
  export function formatMinutes(min: number): string;                      // 452 → "7 h 32 min"
  export function formatSyncAge(iso: string | null, now?: Date): string;   // null → "no data yet", 5 min → "5 min ago", 3 h → "3 h ago", 2 d → "2 days ago"
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/companion/src/today.test.ts
import { describe, expect, it } from "vitest";

import { formatMinutes, formatSyncAge } from "./today";

describe("today helpers", () => {
  it("formats sleep minutes", () => {
    expect(formatMinutes(452)).toBe("7 h 32 min");
    expect(formatMinutes(45)).toBe("45 min");
  });
  it("formats sync age", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    expect(formatSyncAge(null, now)).toBe("no data yet");
    expect(formatSyncAge("2026-10-10T11:55:00Z", now)).toBe("5 min ago");
    expect(formatSyncAge("2026-10-10T09:00:00Z", now)).toBe("3 h ago");
    expect(formatSyncAge("2026-10-08T09:00:00Z", now)).toBe("2 days ago");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/companion && pnpm test`
Expected: FAIL with "Cannot find module './today'"

- [ ] **Step 3: Implement helpers, push and the screen**

```ts
// apps/companion/src/today.ts
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export function formatSyncAge(iso: string | null, now = new Date()): string {
  if (!iso) return "no data yet";
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  const days = Math.round(min / (24 * 60));
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
```

```ts
// apps/companion/src/push.ts
/** Expo push: register the token with the device token (spec §6); route notification taps into the Coach tab. */
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

import { registerPush } from "./api";
import { saveState, type State } from "./sync";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function ensurePushToken(state: State): Promise<State> {
  if (state.expoToken || !Device.isDevice) return state;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return state;
  const { data: expoToken } = await Notifications.getExpoPushTokenAsync();
  await registerPush(state, expoToken, Device.modelName ?? undefined);
  const next = { ...state, expoToken };
  await saveState(next);
  return next;
}

export function usePushRouting(): void {
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse) => {
      const url = r.notification.request.content.data?.url;
      router.push({ pathname: "/(tabs)/coach", params: { url: `vitls://open?url=${encodeURIComponent(typeof url === "string" ? url : "/home")}` } });
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
```

`getExpoPushTokenAsync` needs the EAS `projectId` in `app.json` (`extra.eas.projectId`) in SDK 57; run `eas init` once (the repo has no EAS project yet; this is the one EAS dependency and it is free). In `sync.ts`'s `pair`, after `saveState(state)` and the background task registration, add `return ensurePushToken(state).catch(() => state);` with `import { ensurePushToken } from "./push";` (circular import is fine: `push.ts` only uses `saveState` at call time).

```tsx
// apps/companion/src/app/(tabs)/index.tsx
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { getToday, MISSING_HINTS, quickLog, type TodayView } from "@/api";
import { disconnect, loadState, type State } from "@/sync";
import { formatMinutes, formatSyncAge } from "@/today";

export default function Today() {
  const [state, setState] = useState<State | null>();
  const [view, setView] = useState<TodayView>();
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState<string>();

  const load = useCallback(async () => {
    const s = (await loadState()) ?? null;
    setState(s);
    if (!s) return;
    try {
      setView(await getToday(s));
    } catch (e) {
      if ((e as Error).message === "unauthorized") {
        await disconnect();
        setState(null);
      } else setNote((e as Error).message);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  if (state === undefined) return null;
  if (state === null)
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>VITLS reads your health data from this phone and shows your coach's plan for today.</Text>
        <Button title="Sign in" onPress={() => router.push("/login")} />
      </View>
    );

  const log = async (entries: { metric: string; value: number; unit?: string }[]) => {
    try {
      await quickLog(state, entries.map((e) => ({ ...e, date: view?.date ?? new Date().toISOString().slice(0, 10) })));
      setNote("Saved.");
      void load();
    } catch (e) {
      setNote((e as Error).message);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {view?.readout ? (
        <View style={styles.card}>
          {view.readout.greeting ? <Text style={styles.title}>{view.readout.greeting}</Text> : null}
          <Text style={styles.body}>{view.readout.directive}</Text>
          {view.readout.highlights.map((h) => (
            <Text key={h.metric} style={styles.small}>
              {h.metric}: {h.note}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.body}>No readout yet. Your coach writes one every morning.</Text>
      )}
      <View style={styles.row}>
        <Stat label="Steps" value={view?.metrics.steps?.toLocaleString() ?? "–"} />
        <Stat label="Sleep" value={view?.metrics.sleep_min !== undefined ? formatMinutes(view.metrics.sleep_min) : "–"} />
        <Stat label="Resting HR" value={view?.metrics.resting_hr !== undefined ? `${view.metrics.resting_hr} bpm` : "–"} />
      </View>
      <Text style={styles.small}>Data from this phone: {formatSyncAge(view?.lastBatchAt ?? state.lastSyncAt ?? null)}</Text>
      {view?.missing.map((m) => (
        <Text key={m} style={styles.small}>
          Missing for your goals: {MISSING_HINTS[m] ?? m}
        </Text>
      ))}
      <View style={styles.card}>
        <Text style={styles.title}>Quick log</Text>
        <View style={styles.row}>
          <TextInput style={styles.input} value={weight} onChangeText={setWeight} placeholder="Weight, kg" keyboardType="decimal-pad" />
          <Button title="Save" onPress={() => log([{ metric: "weight", value: Number(weight.replace(",", ".")), unit: "kg" }])} disabled={!Number(weight.replace(",", "."))} />
        </View>
        {note ? <Text style={styles.small}>{note}</Text> : null}
      </View>
      <Text style={styles.small}>VITLS is a coach, not a doctor. Nothing here is medical advice.</Text>
    </ScrollView>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.title}>{value}</Text>
    <Text style={styles.small}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 16 },
  card: { gap: 8, padding: 16, borderRadius: 12, backgroundColor: "#f3f4f6" },
  row: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
  stat: { flex: 1, alignItems: "center" },
  title: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 16 },
  small: { fontSize: 13, color: "#555" },
  input: { flex: 1, borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 10, fontSize: 16 },
});
```

Quick log is weight only: the metric catalog (`packages/health-ingest/src/catalog.ts`) has no mood metric and this plan adds none.

In `(tabs)/_layout.tsx` call `usePushRouting();` at the top of `TabsLayout`.

- [ ] **Step 4: Typecheck, tests, build**

Run: `cd apps/companion && pnpm test && npx tsc --noEmit -p . && npx expo prebuild --platform android --no-install && cd android && ./gradlew assembleDebug`
Expected: tests PASS (api, bridge, today), tsc clean, `BUILD SUCCESSFUL`.

- [ ] **Step 5: On-device check**

Install the APK. Today shows the readout (write one with the coach first: ask "write my readout"), today's steps/sleep/resting HR from the last sync, "Missing for your goals" lines, quick log saves a weight (verify: `docker exec vitls-postgres psql -U vitls -d vitls -c "select metric, value, at from point_metrics where metric='weight' order by at desc limit 1"`). Send a notification from the PWA (Settings → Notifications test, or `manage-notifications send` in chat) → the phone shows a native notification → tapping it opens the Coach tab. Revoke the device in the PWA (`revoke-device`) → the next Today load drops to the sign-in screen.

- [ ] **Step 6: Commit**

```bash
git add apps/companion
git commit -m "feat(companion): native Today screen, quick log and push notifications

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Docs, store checklist, decision log

**Files:**
- Modify: `apps/companion/README.md`
- Create: `apps/companion/STORE.md`
- Modify: `apps/app/AGENTS.md` (onboarding stage 7 "data": mention that in the shell the phone pairs itself and the `<devices>` block says so; the coach does not show a code when `<client>` says shell)
- Modify: `docs/design/02-data-model-and-ingest.md` §5 (list the three new device routes)

- [ ] **Step 1: README**

Replace the "Flow" paragraph and the "Not yet" line in `apps/companion/README.md` with:

```
Flow: sign in with a magic link (the link opens the app via Universal/App Link and signs the Coach WebView in) → the PWA,
detecting the shell, creates a pairing code and hands it over the bridge → the app redeems it for a write-only device token,
registers an Expo push token and starts background sync (expo-background-task, ~15 min). Tabs: Today (native: readout,
steps/sleep/resting HR, quick log), Coach (WebView on the PWA), Settings (device, sync, pairing-code fallback, disconnect).

Device-token routes: POST /api/ingest/v1/batches, GET /api/devices/today, POST /api/devices/log, POST|DELETE /api/devices/push.
Bridge messages ({ v: 1, type }): pair, sync-now (web → native), sync-status (native → web). User agent suffix VITLSCompanion/<version>.

No purchase, price or upgrade path exists in the app (store rule 3.1): premium is a server flag, billing lives on the web.

Not yet: anchored change tracking (sync re-reads a one-day overlap instead), deletions, quick replies, home-screen widget.
```

- [ ] **Step 2: STORE.md**

```markdown
# Store submission checklist (spec §8)

## Reviewer notes (paste into App Store Connect / Play Console)
VITLS Companion is the phone companion of the VITLS web coach. Native features: Apple Health / Health Connect sync
(foreground and background), native push notifications, a Today screen with the coach's readout and quick logging.
The Coach tab shows the user's web account. Every feature in the app is free; subscriptions are managed on the
website only and are neither sold nor referenced in the app.
Test account: <email> / magic link to <inbox> — paired device with 14 days of data.

## iOS
- [ ] `NSHealthShareUsageDescription` names each data type's purpose (app.json)
- [ ] Privacy policy URL in App Store Connect and in Settings → Privacy policy
- [ ] Associated domains `applinks:<domain>`; AASA reachable (`swcutil dl -d <domain>` or https://app-site-association.cdn-apple.com/a/v1/<domain>)
- [ ] Background modes: processing (expo-background-task)
- [ ] Health data is never used for advertising (declare in App Privacy)

## Android
- [ ] Play Console → Health Connect declaration: data types read, purposes, privacy policy
- [ ] Separate justification for READ_HEALTH_DATA_IN_BACKGROUND (background sync of the user's own data)
- [ ] `adb shell pm verify-app-links --re-verify ai.vitls.companion` reports verified for the PWA domain
- [ ] assetlinks.json carries the release signing certificate fingerprint
```

- [ ] **Step 3: AGENTS.md and ingest spec**

In `apps/app/AGENTS.md` stage 7 line, append: "In the mobile shell (`<client>` block present) the phone pairs itself; read `<devices>` and skip the code." In `docs/design/02-data-model-and-ingest.md` §5 add the three routes with one line each (auth: device token; purpose).

- [ ] **Step 4: Commit**

```bash
git add apps/companion/README.md apps/companion/STORE.md apps/app/AGENTS.md docs/design/02-data-model-and-ingest.md
git commit -m "docs: companion shell flow, store checklist, device routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
