import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { analyzeFoodPhoto } from "./food-photo";

const items = [{ name: "Banana", grams: 118, nutrients: { energy_kcal: 105, protein_g: 1.3 } }];
// PNG magic bytes + padding
const png = (extra = 0) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32 + extra)]).toString("base64");

async function stub() {
  const { MockLanguageModelV2 } = await import("ai/test");
  const doGenerate = vi.fn(async () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ items }) }],
    finishReason: "stop" as const,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    warnings: [],
  }));
  return { model: new MockLanguageModelV2({ doGenerate }), doGenerate };
}

describe("analyzeFoodPhoto", () => {
  it("returns the model's items for a valid image (raw base64 and data URL)", async () => {
    const { model, doGenerate } = await stub();
    expect(await analyzeFoodPhoto(png(), "lunch", model)).toEqual({ items });
    expect(await analyzeFoodPhoto(`data:image/png;base64,${png()}`, undefined, model)).toEqual({ items });
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it("rejects non-base64 and non-image input without calling the model", async () => {
    const { model, doGenerate } = await stub();
    await expect(analyzeFoodPhoto("", undefined, model)).rejects.toBeInstanceOf(BadRequestException);
    await expect(analyzeFoodPhoto("not base64 !!!", undefined, model)).rejects.toBeInstanceOf(BadRequestException);
    await expect(analyzeFoodPhoto(Buffer.from("hello world, plain text").toString("base64"), undefined, model)).rejects.toThrow("Not an image");
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it("rejects an oversized payload without calling the model", async () => {
    const { model, doGenerate } = await stub();
    await expect(analyzeFoodPhoto(png(6 * 1024 * 1024), undefined, model)).rejects.toThrow("Image too large");
    expect(doGenerate).not.toHaveBeenCalled();
  });
});
