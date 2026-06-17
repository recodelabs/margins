import { afterEach, describe, expect, it, vi } from "vitest";
import { githubFetch } from "../src/github-fetch";
import { SessionExpiredError } from "../src/storage";

describe("githubFetch session expiry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws SessionExpiredError on a 401 (expired/revoked token)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(
      githubFetch("https://api.github.com/repos/x/y", { headers: {} }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it("passes non-401 responses through unchanged for the caller to interpret", async () => {
    const res = new Response("Not Found", { status: 404 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res);

    await expect(
      githubFetch("https://api.github.com/repos/x/y", { headers: {} }),
    ).resolves.toBe(res);
  });
});
