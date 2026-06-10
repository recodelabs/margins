import { describe, it, expect } from "vitest";
import type { BackendInfo } from "./storage";

describe("BackendInfo github kind", () => {
  it("accepts kind 'github' and an authorLabel", () => {
    const info: BackendInfo = {
      kind: "github",
      label: "GitHub",
      detail: "owner/repo@main",
      authorLabel: "octocat",
    };
    expect(info.kind).toBe("github");
    expect(info.authorLabel).toBe("octocat");
  });
});
