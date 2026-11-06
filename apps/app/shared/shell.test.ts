import { describe, expect, it } from "vitest";

import { isShell, isShellUserAgent } from "./shell";

describe("shell detection", () => {
  it("recognises the companion user agent", () => {
    expect(isShellUserAgent("Mozilla/5.0 (Linux; Android 15) VITLSCompanion/1.0.0")).toBe(true);
    expect(isShellUserAgent("Mozilla/5.0 Safari")).toBe(false);
    expect(isShellUserAgent(undefined)).toBe(false);
  });
  it("is false outside a browser", () => {
    expect(isShell()).toBe(false);
  });
});
