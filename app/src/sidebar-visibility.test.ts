import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readStoredSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  writeStoredSidebarCollapsed,
} from "./sidebar-visibility";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("sidebar visibility", () => {
  it("defaults to expanded (not collapsed)", () => {
    expect(readStoredSidebarCollapsed()).toBe(false);
  });

  it("round-trips the collapsed preference", () => {
    writeStoredSidebarCollapsed(true);
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe("1");
    expect(readStoredSidebarCollapsed()).toBe(true);

    writeStoredSidebarCollapsed(false);
    expect(readStoredSidebarCollapsed()).toBe(false);
  });
});
