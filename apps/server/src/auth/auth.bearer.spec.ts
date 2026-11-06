import { describe, expect, it } from "vitest";
import { buildAuth } from "./auth";

describe("buildAuth bearer plugin", () => {
  it("registers the bearer plugin", async () => {
    const auth = await buildAuth({} as never, { send: async () => {} });
    expect(auth.options.plugins?.some((p: { id: string }) => p.id === "bearer")).toBe(true);
  });
});
