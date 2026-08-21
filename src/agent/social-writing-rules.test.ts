import { describe, expect, it } from "vitest";
import { buildSocialWritingRules, isSocialWritingWorkspace } from "./_social-writing-rules";

describe("social writing rules", () => {
  it.each(["Socials", " social ", "SOCIAL MEDIA", "Content"])(
    "recognizes the %s workspace",
    (workspaceName) => {
      expect(isSocialWritingWorkspace(workspaceName)).toBe(true);
    },
  );

  it.each([undefined, "", "Inbox", "Clients"])(
    "does not affect the %s workspace",
    (workspaceName) => {
      expect(isSocialWritingWorkspace(workspaceName)).toBe(false);
      expect(buildSocialWritingRules(workspaceName)).toBeUndefined();
    },
  );

  it("keeps voice and explicit constraints above the humanizer defaults", () => {
    const rules = buildSocialWritingRules("Socials");

    expect(rules).toContain("user's current request and platform constraints");
    expect(rules).toContain("explicit writing sample or remembered voice");
    expect(rules).toContain("Never invent a detail");
    expect(rules).toContain("Return only the finished post");
  });
});
