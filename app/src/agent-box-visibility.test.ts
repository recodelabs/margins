import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_BOX_HIDDEN_STORAGE_KEY,
  readStoredAgentBoxHidden,
  writeStoredAgentBoxHidden,
} from "./agent-box-visibility";

afterEach(() => {
  window.localStorage.clear();
});

describe("agent-box-hidden persistence", () => {
  it("defaults to shown when nothing is stored", () => {
    expect(readStoredAgentBoxHidden()).toBe(false);
  });

  it("round-trips the hidden preference through localStorage", () => {
    writeStoredAgentBoxHidden(true);
    expect(window.localStorage.getItem(AGENT_BOX_HIDDEN_STORAGE_KEY)).toBe("1");
    expect(readStoredAgentBoxHidden()).toBe(true);

    writeStoredAgentBoxHidden(false);
    expect(window.localStorage.getItem(AGENT_BOX_HIDDEN_STORAGE_KEY)).toBe("0");
    expect(readStoredAgentBoxHidden()).toBe(false);
  });

  it('treats any non-"1" stored value as shown', () => {
    window.localStorage.setItem(AGENT_BOX_HIDDEN_STORAGE_KEY, "true");
    expect(readStoredAgentBoxHidden()).toBe(false);
  });
});
