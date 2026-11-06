import { HttpException } from "@nestjs/common";
import { coachModel, hasCoachKey } from "./model";

describe("coach model", () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  });

  it("hasCoachKey reflects the env", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(hasCoachKey()).toBe(true);
    delete process.env.ANTHROPIC_API_KEY;
    expect(hasCoachKey()).toBe(false);
  });

  it("throws 503 coach_unavailable without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const err = await coachModel().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({ error: "Coach model not configured", errorCode: "coach_unavailable" });
  });

  it("returns a model with a key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(await coachModel()).toBeTruthy();
  });
});
