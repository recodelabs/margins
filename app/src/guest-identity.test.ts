import { beforeEach, describe, expect, it } from "vitest";
import { getGuestName, setGuestName } from "./guest-identity";

beforeEach(() => localStorage.clear());

describe("guest identity", () => {
  it("returns '' when unset and round-trips a trimmed name", () => {
    expect(getGuestName()).toBe("");
    setGuestName("  Jane  ");
    expect(getGuestName()).toBe("Jane");
  });
});
