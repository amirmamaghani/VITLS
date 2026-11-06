import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

import { coachModel } from "./model";

type LanguageModel = import("ai", { with: { "resolution-mode": "import" } }).LanguageModel;

const MAX_BYTES = 5 * 1024 * 1024;
const MAGIC: [number, number[]][] = [[0, [0xff, 0xd8, 0xff]], [0, [0x89, 0x50, 0x4e, 0x47]], [0, [0x47, 0x49, 0x46, 0x38]], [0, [0x52, 0x49, 0x46, 0x46]]]; // jpeg, png, gif, webp(RIFF)

const schema = z.object({ items: z.array(z.object({ name: z.string(), grams: z.number(), nutrients: z.record(z.string(), z.number()) })) });

/** Identify foods in a photo. Pure analysis: logs nothing; the coach confirms, then uses search-foods / log-meal. */
export async function analyzeFoodPhoto(imageBase64: string, note?: string, model?: LanguageModel): Promise<z.infer<typeof schema>> {
  const b64 = imageBase64.replace(/^data:image\/[\w.+-]+;base64,/, "").replace(/\s/g, "");
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1) throw new BadRequestException("Not an image");
  if (b64.length * 0.75 > MAX_BYTES) throw new BadRequestException("Image too large");
  const bytes = Buffer.from(b64, "base64");
  if (!MAGIC.some(([o, m]) => m.every((b, i) => bytes[o + i] === b))) throw new BadRequestException("Not an image");

  const { generateObject } = await import("ai");
  const text = `Identify each food in this photo. For each, estimate the weight in grams and the per-item nutrients (energy_kcal, protein_g, carbs_g, fat_g).${note ? ` Note: ${note}` : ""}`;
  const result = await generateObject({
    model: model ?? (await coachModel()),
    schema,
    messages: [{ role: "user", content: [{ type: "text", text }, { type: "image", image: bytes }] }],
  });
  return { items: result.object.items };
}
