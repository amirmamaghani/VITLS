import { HttpException } from "@nestjs/common";

type LanguageModel = import("ai", { with: { "resolution-mode": "import" } }).LanguageModel;

export const hasCoachKey = (): boolean => !!process.env.ANTHROPIC_API_KEY;

/** Async because the ESM-only provider is loaded via dynamic import. */
export async function coachModel(): Promise<LanguageModel> {
  if (!hasCoachKey()) {
    throw new HttpException({ error: "Coach model not configured", errorCode: "coach_unavailable" }, 503);
  }
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return provider(process.env.COACH_MODEL ?? "claude-sonnet-5-5");
}
