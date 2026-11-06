/**
 * Coach profile in the native user-settings store, plus the personal morning-readout job resource.
 * See docs/design/03-coach.md §2 and §9.
 */
import { buildJobResourceContent } from "@agent-native/core/jobs/frontmatter";
import { resourceDelete, resourceGetByPath, resourcePut } from "@agent-native/core/resources";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

import { coachProfileSchema, type CoachProfile } from "../../../shared/coach";

const SETTING_KEY = "vitls-coach";
export const READOUT_JOB_PATH = "jobs/morning-readout.md";

export async function getCoachProfile(userEmail: string) {
  const profile = coachProfileSchema.parse((await getUserSetting(userEmail, SETTING_KEY)) ?? {});
  return {
    profile,
    onboarded: profile.onboardingStage === "done",
    readoutScheduled: (await resourceGetByPath(userEmail, READOUT_JOB_PATH)) !== null,
  };
}

/** Validates and merges a patch, then keeps the readout job in sync with readoutTime/timezone. */
export async function updateCoachProfile(userEmail: string, patch: CoachProfile): Promise<CoachProfile> {
  const changes = coachProfileSchema.parse(patch);
  const merged = (await mutateUserSetting(userEmail, SETTING_KEY, (current) => ({ ...(current ?? {}), ...changes }))) as CoachProfile;
  if ("readoutTime" in changes || "timezone" in changes) await syncReadoutJob(userEmail, merged);
  return merged;
}

async function syncReadoutJob(userEmail: string, profile: CoachProfile) {
  if (!profile.readoutTime) {
    const existing = await resourceGetByPath(userEmail, READOUT_JOB_PATH);
    if (existing) await resourceDelete(existing.id);
    return;
  }
  const [hour, minute] = profile.readoutTime.split(":").map(Number);
  const content = buildJobResourceContent(
    {
      schedule: `${minute} ${hour} * * *`,
      enabled: true,
      ...(profile.timezone ? { timezone: profile.timezone } : {}),
      runAs: "creator",
      createdBy: userEmail,
      triggerType: "schedule",
    },
    "Run the `morning-readout` skill for this user.",
  );
  await resourcePut(userEmail, READOUT_JOB_PATH, content);
}
