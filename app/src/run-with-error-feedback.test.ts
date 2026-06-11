import { describe, expect, it, vi } from "vitest";
import { runWithErrorFeedback } from "./run-with-error-feedback";

describe("runWithErrorFeedback", () => {
  it("runs the action and reports nothing on success", async () => {
    const report = vi.fn();
    const action = vi.fn(async () => {});

    await runWithErrorFeedback(action, report, "fallback");

    expect(action).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports the error message and does not reject when the action throws", async () => {
    const report = vi.fn();

    // The whole point: this resolves (no unhandled rejection) even though the
    // action rejects — the caller fires it as `void runWithErrorFeedback(...)`.
    await expect(
      runWithErrorFeedback(
        async () => {
          throw new Error("disk read failed");
        },
        report,
        "fallback",
      ),
    ).resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith("disk read failed");
  });

  it("falls back when the thrown value is not an Error", async () => {
    const report = vi.fn();

    await runWithErrorFeedback(
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "just a string";
      },
      report,
      "Could not complete the action.",
    );

    expect(report).toHaveBeenCalledWith("Could not complete the action.");
  });

  it("falls back when the Error has an empty message", async () => {
    const report = vi.fn();

    await runWithErrorFeedback(
      async () => {
        throw new Error("");
      },
      report,
      "default message",
    );

    expect(report).toHaveBeenCalledWith("default message");
  });

  it("supports synchronous actions too", async () => {
    const report = vi.fn();
    let ran = false;

    await runWithErrorFeedback(
      () => {
        ran = true;
      },
      report,
      "fallback",
    );

    expect(ran).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });
});
