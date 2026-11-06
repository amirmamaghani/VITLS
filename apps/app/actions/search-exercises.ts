import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { searchExercises } from "../server/lib/exercises";

export default defineAction({
  description:
    "Search the exercise library (1,324 exercises: name, body part, equipment, target muscle). Every query word must match. Use the returned id in save-training-plan. Body parts: back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist.",
  schema: z.object({
    query: z.string().max(80).optional().describe('Words to match, e.g. "lateral raise", "romanian deadlift"'),
    bodyPart: z.string().max(40).optional(),
    equipment: z.string().max(40).optional().describe('e.g. "dumbbell", "cable", "barbell", "body weight", "leverage machine"'),
    target: z.string().max(40).optional().describe('Primary muscle, e.g. "delts", "lats", "glutes"'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => ({ exercises: searchExercises(args) }),
});
