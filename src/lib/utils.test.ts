import { describe, expect, it } from "vitest";
import { getTodayLocalISO, isOverdue } from "./_utils";

describe("getTodayLocalISO", () => {
  it("returns today's local date as YYYY-MM-DD", () => {
    expect(getTodayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isOverdue", () => {
  const today = "2026-07-21";

  it("is overdue when pending and scheduled before today", () => {
    expect(isOverdue({ status: "pending", scheduledDate: "2026-07-20" }, today)).toBe(true);
  });

  it("is not overdue when scheduled for today", () => {
    expect(isOverdue({ status: "pending", scheduledDate: today }, today)).toBe(false);
  });

  it("is not overdue when scheduled in the future", () => {
    expect(isOverdue({ status: "pending", scheduledDate: "2026-07-22" }, today)).toBe(false);
  });

  it("is not overdue when there is no scheduled date", () => {
    expect(isOverdue({ status: "pending", scheduledDate: null }, today)).toBe(false);
  });

  it("is not overdue for non-pending statuses even if past-dated", () => {
    expect(isOverdue({ status: "completed", scheduledDate: "2026-07-20" }, today)).toBe(false);
    expect(isOverdue({ status: "suggested", scheduledDate: "2026-07-20" }, today)).toBe(false);
    expect(isOverdue({ status: "archived", scheduledDate: "2026-07-20" }, today)).toBe(false);
  });
});
