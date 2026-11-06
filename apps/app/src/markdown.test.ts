import { describe, expect, it } from "vitest";

import { inlineSpans, parse } from "./markdown";

// First block of a parse, as the renderer feeds it to inlineSpans.
const firstBlock = (md: string) => parse(md).children![0] as never;

describe("inlineSpans", () => {
  it("flattens nested strong/emphasis and inline code into merged styled spans", () => {
    expect(inlineSpans(firstBlock("normal **bold _italic_** `code`"))).toEqual([
      { text: "normal " },
      { bold: true, text: "bold " },
      { bold: true, italic: true, text: "italic" },
      { text: " " },
      { code: true, text: "code" },
    ]);
  });

  it("carries a link's url onto its text spans", () => {
    expect(inlineSpans(firstBlock("see [docs](https://x.y)"))).toContainEqual({ href: "https://x.y", text: "docs" });
  });
});

describe("parse (GFM)", () => {
  it("parses a GFM table into a table node with rows and cells (not plain text)", () => {
    const table = firstBlock("| A | B |\n|---|---|\n| 1 | 2 |") as { type: string; children: { children: unknown[] }[] };
    expect(table.type).toBe("table");
    expect(table.children).toHaveLength(2); // header + one body row
    expect(table.children[0].children).toHaveLength(2); // two columns
  });
});
