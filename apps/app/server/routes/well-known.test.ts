import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { mockEvent } from "h3";
import { describe, expect, it } from "vitest";

const aasaFile = () =>
  JSON.parse(readFileSync(resolve(__dirname, "../lib/apple-app-site-association.json"), "utf8"));
const pub = (f: string) =>
  JSON.parse(readFileSync(resolve(__dirname, "../../public/.well-known", f), "utf8"));

describe("universal / app link files", () => {
  it("AASA routes the whole PWA domain into the companion (no framework paths spelled out)", () => {
    const aasa = aasaFile();
    const detail = aasa.applinks.details[0];
    expect(detail.appIDs[0]).toMatch(/\.ai\.vitls\.companion$/);
    expect(detail.components.map((c: { "/": string }) => c["/"])).toEqual(["*"]);
  });
  it("assetlinks names the companion package", () => {
    const [link] = pub("assetlinks.json");
    expect(link.target.package_name).toBe("ai.vitls.companion");
    expect(link.relation).toContain("delegate_permission/common.handle_all_urls");
  });
  it("route handler serves the AASA as JSON, identical to the JSON source", async () => {
    const { default: handler } = await import("./.well-known/apple-app-site-association.get");
    const event = mockEvent("http://localhost/.well-known/apple-app-site-association");
    const body = await handler(event);
    expect(body).toEqual(aasaFile());
    expect(event.res.headers.get("content-type")).toBe("application/json");
  });
});
