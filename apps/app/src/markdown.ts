/** Pure markdown helpers (no RN import, so they unit-test without the RN runtime — see chat.ts). */
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// mdast nodes, typed loosely: the renderer walks them structurally (CommonMark + GFM tables).
export type Node = { type: string; value?: string; url?: string; depth?: number; ordered?: boolean; start?: number; children?: Node[] };

/** Parse markdown to an mdast root, GFM on (tables, strikethrough, autolinks). Partial markdown (mid-stream) parses best-effort. */
export function parse(text: string): Node {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as unknown as Node;
}
type Flags = { bold?: boolean; italic?: boolean; code?: boolean; href?: string };
export type Span = Flags & { text: string };

/** Flatten an inline parent (strong/emphasis/inlineCode/link nest) into merged styled spans; `break` → newline. */
export function inlineSpans(node: Node, f: Flags = {}): Span[] {
  switch (node.type) {
    case "text":
      return node.value ? [{ ...f, text: node.value }] : [];
    case "inlineCode":
      return [{ ...f, code: true, text: node.value ?? "" }];
    case "break":
      return [{ ...f, text: "\n" }];
    case "strong":
      return (node.children ?? []).flatMap((c) => inlineSpans(c, { ...f, bold: true }));
    case "emphasis":
      return (node.children ?? []).flatMap((c) => inlineSpans(c, { ...f, italic: true }));
    case "link":
      return (node.children ?? []).flatMap((c) => inlineSpans(c, { ...f, href: node.url }));
    default:
      return (node.children ?? []).flatMap((c) => inlineSpans(c, f));
  }
}
