import { describe, expect, it } from "vitest";
import { cycleIntent, inferInputIntent } from "./_infer-input-intent";

describe("inferInputIntent", () => {
  it("detects URLs as links", () => {
    expect(inferInputIntent("https://example.com")).toBe("link");
  });

  it("detects questions as chat", () => {
    expect(inferInputIntent("How many unread emails do I have?")).toBe("chat");
  });

  it("detects chat starters", () => {
    expect(inferInputIntent("Summarize my inbox from today")).toBe("chat");
  });

  it("detects long project notes", () => {
    const long = "Meeting notes from the call.\n\nWe agreed to ship next week and follow up on pricing.";
    expect(inferInputIntent(long, { hasActiveProject: true, multiline: true })).toBe("note");
  });

  it("defaults to todo for short action text", () => {
    expect(inferInputIntent("Buy milk")).toBe("todo");
  });
});

describe("cycleIntent", () => {
  it("includes note when a project is active", () => {
    expect(cycleIntent("todo", true)).toBe("chat");
    expect(cycleIntent("note", true)).toBe("link");
  });
});
