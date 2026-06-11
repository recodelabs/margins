import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GitHubPicker } from "./GitHubPicker";
import { clearGitHubCache } from "./github-cache";

const TOKEN_KEY = "roughneck.gh.token";
const originalFetch = global.fetch;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearGitHubCache();
  sessionStorage.setItem(TOKEN_KEY, "tok");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  sessionStorage.clear();
  global.fetch = originalFetch;
});

/** Set an input's value the way React's change tracking expects, then fire it. */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("GitHubPicker tree-fetch debounce", () => {
  it("fires a single tree request after the user stops typing, not one per keystroke", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ tree: [] }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => {
      root.render(<GitHubPicker />);
    });

    const input = container.querySelector<HTMLInputElement>("#gh-repo-input");
    if (!input) throw new Error("repo input not found");

    // Type "own/repo" one character at a time.
    for (const value of ["o", "ow", "own/", "own/r", "own/repo"]) {
      act(() => {
        typeInto(input, value);
      });
    }

    // Nothing fetched yet — every keystroke reset the debounce timer.
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // Exactly one request, and it's the recursive tree listing.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/git/trees/");
    expect(String(fetchMock.mock.calls[0][0])).toContain("recursive=1");
  });
});
