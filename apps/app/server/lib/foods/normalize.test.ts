import { describe, expect, it } from "vitest";

import { searchKey } from "./normalize";

describe("searchKey", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(searchKey("  Tvaroh   POLOTUČNÝ ")).toBe("tvaroh polotucny");
    expect(searchKey("Crème fraîche, épaisse")).toBe("creme fraiche epaisse");
  });
});
