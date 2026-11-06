import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { getCoachProfile } from "../server/lib/coach/profile";
import { logManual } from "../server/lib/ingest/manual";
import { requireOwner } from "../server/lib/ingest/owner";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export default defineAction({
  description:
    "Log health values the user entered or told you in chat (the fallback when no tracker provides them): daily metrics (steps, sleep_duration, resting_hr, active_energy…), measurements (weight, body_fat_pct, muscle_mass, blood_pressure_systolic/diastolic, vo2max…) and workouts. Units default to the metric's canonical unit (kg, s, m, kcal, bpm, %); pass e.g. unit \"lb\", \"h\", \"km\" to convert. Dates default to today in the user's timezone. Repeat values for the same metric and day replace the earlier manual entry. Device data takes precedence over manual data for the same day. Food intake (intake_* metrics) is not accepted here: log what the user ate with log-meal.",
  schema: z.object({
    entries: z
      .array(
        z.object({
          metric: z.string().describe("Metric key, e.g. weight, steps, sleep_duration, resting_hr"),
          value: z.number().finite(),
          unit: z.string().max(10).optional(),
          date: day.optional().describe("YYYY-MM-DD; default today"),
          at: z.string().datetime({ offset: true }).optional().describe("Exact time for measurements (weigh-in); overrides date"),
        }),
      )
      .max(50)
      .default([]),
    workouts: z
      .array(
        z.object({
          type: z.string().max(64).describe("e.g. strength_training, running, cycling, swimming"),
          start: z.string().datetime({ offset: true }),
          durationMin: z.number().positive().max(24 * 60),
          distanceKm: z.number().nonnegative().optional(),
          energyKcal: z.number().nonnegative().optional(),
        }),
      )
      .max(10)
      .default([]),
  }),
  run: async ({ entries, workouts }, ctx) => {
    const owner = await requireOwner(ctx);
    if (entries.length === 0 && workouts.length === 0) fail("Nothing to log", { statusCode: 400, errorCode: "empty" });
    const { profile } = await getCoachProfile(owner.userEmail);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: profile.timezone ?? "UTC" });
    try {
      const result = await logManual(owner, {
        entries: entries.map((e) => ({ metric: e.metric, value: e.value, unit: e.unit, when: e.at ?? e.date ?? today })),
        workouts,
      });
      return { stored: result.stored, message: "Logged." };
    } catch (error) {
      fail(error instanceof Error ? error.message.slice(0, 300) : "Invalid entry", { statusCode: 400, errorCode: "invalid_entry" });
    }
  },
});
