import { beforeAll, describe, expect, it } from "vitest";

import { isDirectLink, serverUrl } from "./bridge";

const S = "https://vitls.example";
let redirect: (p: { path: string; initial: boolean }) => string;

beforeAll(async () => {
  process.env.EXPO_PUBLIC_VITLS_SERVER = S; // read at module load
  ({ redirectSystemPath: redirect } = await import("./app/+native-intent"));
});

const go = (path: string) => redirect({ path, initial: false });
const VERIFY = `${S}/_fw/auth/link/verify?token=abc`;

describe("redirectSystemPath", () => {
  it("routes https links on the server origin to Coach and remembers them as direct", () => {
    expect(go(`${S}/home?x=1`)).toBe(`/coach?url=${encodeURIComponent(`${S}/home?x=1`)}`);
    expect(go(VERIFY)).toBe(`/coach?url=${encodeURIComponent(VERIFY)}`);
    expect(isDirectLink(VERIFY)).toBe(true);
    expect(serverUrl(VERIFY, S, isDirectLink(VERIFY))).toBe(VERIFY);
  });

  it("routes vitls://open to Coach with its url", () => {
    expect(go("vitls://open?url=%2Fhome%2Fplan")).toBe(`/coach?url=${encodeURIComponent("/home/plan")}`);
    expect(go("vitls://open")).toBe(`/coach?url=${encodeURIComponent("/home")}`);
  });

  it("leaves vitls://pair and off-origin links unchanged", () => {
    expect(go("vitls://pair?code=ABCD-EFGH-JKLM")).toBe("vitls://pair?code=ABCD-EFGH-JKLM");
    expect(go("https://evil.example/home")).toBe("https://evil.example/home");
    expect(go("https://vitls.example.evil.com/home")).toBe("https://vitls.example.evil.com/home");
  });

  it("refuses sign-in paths that arrive through vitls://open (login CSRF)", () => {
    expect(go(`vitls://open?url=${encodeURIComponent(VERIFY)}`)).toBe("/coach");
    expect(go(`vitls://open?url=${encodeURIComponent("/_fw/auth/link/verify?token=abc")}`)).toBe("/coach");
    expect(go(`vitls://open?url=${encodeURIComponent("/%5ffw/auth/x")}`)).toBe("/coach");
    expect(go(`vitls://open?url=${encodeURIComponent("/_Agent-Native//auth/x")}`)).toBe("/coach");
    expect(isDirectLink(`${S}/_fw/auth/link/verify?token=other`)).toBe(false);
  });
});
