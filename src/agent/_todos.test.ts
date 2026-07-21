import { describe, expect, it } from "vitest";
import { computeTodosEtag } from "./_todos";

describe("computeTodosEtag", () => {
  it("is deterministic for identical payloads", () => {
    const payload = JSON.stringify({ todos: [{ id: "a", title: "x" }], preferences: {} });
    expect(computeTodosEtag(payload)).toBe(computeTodosEtag(payload));
  });

  it("changes when the payload changes (e.g. a task is completed)", () => {
    const before = JSON.stringify({ todos: [{ id: "a", status: "pending" }] });
    const after = JSON.stringify({ todos: [{ id: "a", status: "completed" }] });
    expect(computeTodosEtag(before)).not.toBe(computeTodosEtag(after));
  });

  it("produces a weak ETag string", () => {
    expect(computeTodosEtag("{}")).toMatch(/^W\/".+"$/);
  });

  it("distinguishes payloads of different lengths", () => {
    expect(computeTodosEtag("a")).not.toBe(computeTodosEtag("ab"));
  });
});
