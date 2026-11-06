/**
 * Training plan designed by the coach (docs/design/05-training.md). Stored via SettingsService key `vitls-training`.
 * Exercises reference the bundled exercise index (vendor/exercises-dataset, MIT data, no media).
 */
import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const plannedExerciseSchema = z.object({
  exerciseId: z.string().regex(/^\d{4}$/).describe("Exercise id from search-exercises"),
  sets: z.number().int().min(1).max(10),
  reps: z.string().trim().min(1).max(20).describe('Rep target, e.g. "8-12", "15", "30 s"'),
  rir: z.number().int().min(0).max(5).optional().describe("Reps in reserve"),
  note: z.string().trim().max(160).optional().describe("One technique cue or adaptation (e.g. injury-safe variant)"),
});

export const trainingPlanSchema = z.object({
  name: z.string().trim().min(1).max(80),
  days: z
    .array(
      z.object({
        weekday: z.enum(WEEKDAYS),
        title: z.string().trim().min(1).max(80),
        exercises: z.array(plannedExerciseSchema).max(12).default([]).describe("Empty for a rest / cardio day"),
      }),
    )
    .max(7)
    .refine((d) => new Set(d.map((x) => x.weekday)).size === d.length, "One entry per weekday."),
  notes: z.string().trim().max(400).optional(),
});

export type TrainingPlan = z.infer<typeof trainingPlanSchema>;
