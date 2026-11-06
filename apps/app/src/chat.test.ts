import { describe, expect, it } from "vitest";

import { chatTitle, classifyPart, isUnauthorized, pickCurrentChat, pickDashboardId, type ChatSummary } from "./chat";

const threads: ChatSummary[] = [
  { dashboardId: "b2", title: "Obed foto", updatedAt: "2026-10-13T10:00:00Z" },
  { dashboardId: "b1", title: "Ranný beh", updatedAt: "2026-10-12T10:00:00Z" },
];

describe("chat switcher helpers", () => {
  it("picks the last chat when it still exists, else the most recent", () => {
    expect(pickCurrentChat(threads, "b1")).toBe("b1");
    expect(pickCurrentChat(threads, "gone")).toBe("b2");
    expect(pickCurrentChat(threads, null)).toBe("b2");
    expect(pickCurrentChat([], "b1")).toBeUndefined();
  });
  it("labels a chat by its title, with a default for an untitled/new chat", () => {
    expect(chatTitle(threads, "b1")).toBe("Ranný beh");
    expect(chatTitle(threads, "new")).toBe("New chat");
    expect(chatTitle([{ dashboardId: "b3", title: null, updatedAt: null }], "b3")).toBe("New chat");
  });
});

describe("chat helpers", () => {
  it("picks the first board or falls back", () => {
    expect(pickDashboardId([{ id: "b1" }, { id: "b2" }])).toBe("b1");
    expect(pickDashboardId([])).toBe("default");
    expect(pickDashboardId(null)).toBe("default");
  });

  it("classifies text and tool parts", () => {
    expect(classifyPart({ type: "text", text: "hi" })).toEqual({ kind: "text", text: "hi" });
    expect(classifyPart({ type: "text", text: "" })).toBeNull();
    expect(classifyPart({ type: "step-start" })).toBeNull();
    expect(classifyPart({ type: "file", url: "data:image/jpeg;base64,xxx" })).toEqual({ kind: "image", url: "data:image/jpeg;base64,xxx" });
    expect(classifyPart({ type: "file" })).toBeNull();
    expect(classifyPart({ type: "tool-log-meal", output: { kcal: 300 } })).toEqual({ kind: "tool", name: "log-meal", summary: '{"kcal":300}' });
    expect(classifyPart({ type: "tool-show-widget", state: "input-streaming" })).toEqual({ kind: "tool", name: "show-widget", summary: "input-streaming" });
  });

  it("detects unauthorized reliably", () => {
    expect(isUnauthorized(new Error('{"error":"Unauthorized","errorCode":"unauthorized"}'))).toBe(true);
    expect(isUnauthorized(new Error("unauthorized"))).toBe(true);
    expect(isUnauthorized(new Error("HTTP 500"))).toBe(false);
    expect(isUnauthorized(new Error("not unauthorized-ish text"))).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});
