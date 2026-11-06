/**
 * Coach data shared by UI and agent: personas, goal modules and the profile shape.
 * Plain records — coaching knowledge per goal lives in runtime skills (.agents/skills/goal-*), not here.
 */
import { z } from "zod";

export const PERSONAS = {
  strict: { name: "Strict", defaultStrictness: "strict", voice: "Direct, demanding, no excuses. Names drift plainly, praises earned wins briefly." },
  scientist: { name: "Scientist", defaultStrictness: "balanced", voice: "Calm and analytical. Leads with numbers and trends; one sentence of physiology when it changes the plan." },
  supportive: { name: "Supportive", defaultStrictness: "gentle", voice: "Warm and encouraging. Focuses on habits and small wins, never shames, still honest about the data." },
  longevity: { name: "Longevity mentor", defaultStrictness: "balanced", voice: "Long-horizon and steady. Prioritizes sleep, HRV, stress and consistency over short-term numbers." },
} as const;

export const GOAL_MODULES = {
  fat_loss: { label: "Fat loss / recomposition", metrics: ["weight", "body_fat_pct", "active_energy", "steps"] },
  muscle_gain: { label: "Muscle gain", metrics: ["weight", "muscle_mass", "training_readiness"] },
  strength: { label: "Strength", metrics: ["training_readiness", "resting_hr"] },
  endurance: { label: "Running / endurance", metrics: ["vo2max", "distance", "resting_hr", "hrv_rmssd_night"] },
  vo2max: { label: "VO2max / cardio fitness", metrics: ["vo2max", "resting_hr", "intensity_minutes"] },
  swim: { label: "Swimming", metrics: ["distance", "intensity_minutes"] },
  longevity: { label: "General health / longevity", metrics: ["hrv_rmssd_night", "resting_hr", "sleep_duration", "sleep_score", "steps", "weight"] },
} as const;

const ONBOARDING_STAGES = ["welcome", "goals", "starting_point", "constraints", "style", "rhythm", "data", "dashboard", "done"] as const;

export const coachProfileSchema = z.object({
  persona: z.enum(Object.keys(PERSONAS) as [keyof typeof PERSONAS, ...(keyof typeof PERSONAS)[]]).optional(),
  strictness: z.enum(["gentle", "balanced", "strict"]).optional(),
  language: z.string().min(2).max(35).optional().describe("BCP 47 tag of the language the coach speaks, e.g. sk, en-GB"),
  timezone: z.string().min(1).max(64).optional().describe("IANA timezone, e.g. Europe/Bratislava"),
  units: z.enum(["metric", "imperial"]).optional(),
  readoutTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional()
    .describe("Local HH:MM for the morning readout; null turns it off"),
  birthYear: z.number().int().min(1900).max(new Date().getFullYear()).optional().describe("Year of birth; the app derives age from it (VO2max and heart-rate norms)"),
  sex: z.enum(["male", "female"]).optional().describe("Biological sex used for physiological norms (VO2max, body composition ranges)"),
  onboardingStage: z.enum(ONBOARDING_STAGES).optional(),
  goals: z
    .array(
      z.object({
        module: z.enum(Object.keys(GOAL_MODULES) as [keyof typeof GOAL_MODULES, ...(keyof typeof GOAL_MODULES)[]]),
        priority: z.number().int().min(1).max(5).default(1),
        targets: z.record(z.string(), z.union([z.string(), z.number()])).default({}).describe("Free-form targets, e.g. { bodyFatPct: 17, by: '2026-12-31' }"),
        context: z.string().max(500).optional().describe("Starting point / experience notes"),
      }),
    )
    .max(7)
    .optional(),
});

export type CoachProfile = z.infer<typeof coachProfileSchema>;
