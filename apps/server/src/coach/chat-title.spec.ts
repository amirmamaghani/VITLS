import { describe, expect, it } from "vitest";

import { deriveThreadTitle, mergeThread } from "./chat.service";

type UIMessage = import("ai", { with: { "resolution-mode": "import" } }).UIMessage;
const user = (text: string): UIMessage => ({ id: "m", role: "user", parts: [{ type: "text", text }] });
const msg = (id: string, role: "user" | "assistant"): UIMessage => ({ id, role, parts: [{ type: "text", text: role }] });

describe("mergeThread", () => {
  it("appends only client messages whose id isn't already stored", () => {
    const prior = [msg("u1", "user"), msg("a1", "assistant")];
    expect(mergeThread(prior, [msg("u1", "user"), msg("u2", "user")]).map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
  });
  it("never collapses prior messages that share an id or have an empty one (the bug that lost assistant replies)", () => {
    const prior: UIMessage[] = [msg("u1", "user"), msg("", "assistant"), msg("u2", "user"), msg("", "assistant")];
    const merged = mergeThread(prior, [msg("u3", "user")]);
    expect(merged.filter((m) => m.role === "assistant")).toHaveLength(2); // both empty-id assistants survive
    expect(merged.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
  });
});

describe("deriveThreadTitle", () => {
  it("uses the first user message, collapsed", () => {
    expect(deriveThreadTitle([user("  Ako   na lepší\nspánok?  ")])).toBe("Ako na lepší spánok?");
  });
  it("caps long titles on a word boundary with an ellipsis", () => {
    const t = deriveThreadTitle([user("Chcem zlepšiť svoj spánok a aj celkovú regeneráciu tela po tréningu")]);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t).not.toContain("  ");
  });
  it("falls back when there is no user text (e.g. a photo-only message)", () => {
    expect(deriveThreadTitle([{ id: "m", role: "user", parts: [{ type: "file", mediaType: "image/jpeg", url: "data:," }] } as UIMessage])).toBe("New chat");
    expect(deriveThreadTitle([])).toBe("New chat");
  });
});
