import { beforeAll, describe, expect, it } from "vitest";

import { isDirectLink } from "./bridge";

const S = "https://vitls.example";
let redirect: (p: { path: string; initial: boolean }) => string;

beforeAll(async () => {
  process.env.EXPO_PUBLIC_VITLS_SERVER = S; // read at module load
  ({ redirectSystemPath: redirect } = await import("./app/+native-intent"));
});

const go = (path: string) => redirect({ path, initial: false });
const VERIFY = `${S}/_fw/auth/link/verify?token=abc`;
const MAGIC = `${S}/_vitls/auth/magic-link/verify?token=abc&callbackURL=%2F`;

describe("redirectSystemPath", () => {
  it("routes https links on the server origin to native Chat", () => {
    expect(go(`${S}/home?x=1`)).toBe("/chat");
    expect(go(VERIFY)).toBe("/chat");
  });

  it("routes the magic-link verify to the native verify screen", () => {
    expect(go(MAGIC)).toBe(`/verify?url=${encodeURIComponent(MAGIC)}`);
  });

  it("routes vitls://open to Chat without a url", () => {
    expect(go("vitls://open?url=%2Fhome%2Fplan")).toBe("/chat");
    expect(go("vitls://open")).toBe("/chat");
  });

  it("leaves vitls://pair and off-origin links unchanged", () => {
    expect(go("vitls://pair?code=ABCD-EFGH-JKLM")).toBe("vitls://pair?code=ABCD-EFGH-JKLM");
    expect(go("https://evil.example/home")).toBe("https://evil.example/home");
    expect(go("https://vitls.example.evil.com/home")).toBe("https://vitls.example.evil.com/home");
  });

  it("never forwards a sign-in path from vitls://open (login CSRF)", () => {
    expect(go(`vitls://open?url=${encodeURIComponent(VERIFY)}`)).toBe("/chat");
    expect(isDirectLink(`${S}/_fw/auth/link/verify?token=other`)).toBe(false);
  });
});
