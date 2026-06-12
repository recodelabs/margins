import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubPicker } from "./GitHubPicker";
import { clearGitHubCache } from "./github-cache";

const TOKEN_KEY = "margins.gh.token";
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

describe("GitHubPicker file open", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("opens a file via SPA pushState + popstate, not a full reload", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tree: [{ path: "README.md", type: "blob" }],
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => {
      root.render(<GitHubPicker />);
    });

    const input = container.querySelector<HTMLInputElement>("#gh-repo-input");
    if (!input) throw new Error("repo input not found");
    act(() => {
      typeInto(input, "own/repo");
    });

    // Let the debounced tree fetch resolve so the file row renders.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const fileButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => b.textContent?.includes("README.md"));
    if (!fileButton) throw new Error("README.md row not found");

    // pushState (not a full-reload location.assign) is the SPA signal here.
    const pushSpy = vi.spyOn(window.history, "pushState");
    const onPopState = vi.fn();
    window.addEventListener("popstate", onPopState);

    act(() => {
      fileButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe("/own/repo/README.md");
    expect(onPopState).toHaveBeenCalledTimes(1);

    window.removeEventListener("popstate", onPopState);
    pushSpy.mockRestore();
  });
});

describe("GitHubPicker new-file creation", () => {
  async function loadRepo(treePaths: string[]) {
    const treeMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            tree: treePaths.map((p) => ({ path: p, type: "blob" })),
          }),
          { status: 200 },
        ),
    );
    global.fetch = treeMock as unknown as typeof fetch;

    vi.useFakeTimers();
    await act(async () => {
      root.render(<GitHubPicker />);
    });
    const input = container.querySelector<HTMLInputElement>("#gh-repo-input");
    if (!input) throw new Error("repo input not found");
    await act(async () => {
      typeInto(input, "own/repo");
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
  }

  function findButtonByText(text: string): HTMLButtonElement | null {
    const all = Array.from(document.querySelectorAll("button"));
    return (all.find((b) => b.textContent?.includes(text)) ??
      null) as HTMLButtonElement | null;
  }

  it("shows a New file button once a repo is loaded and creates a file via PUT", async () => {
    await loadRepo(["docs/existing.md"]);

    const newFileBtn = findButtonByText("New file");
    expect(newFileBtn).not.toBeNull();

    await act(async () => {
      newFileBtn?.click();
    });

    const nameInput = document.body.querySelector<HTMLInputElement>(
      "#new-file-name-input",
    );
    if (!nameInput) throw new Error("new-file name input not found");
    expect(nameInput.value).toBe("untitled.md");

    const putMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: { sha: "created1" } }), {
          status: 201,
        }),
    );
    global.fetch = putMock as unknown as typeof fetch;

    await act(async () => {
      typeInto(nameInput, "my-notes.md");
    });
    const createBtn = findButtonByText("Create file");
    await act(async () => {
      createBtn?.click();
    });

    expect(putMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/own/repo/contents/my-notes.md",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(
      (putMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.sha).toBeUndefined();
    expect(body.message).toBe("Create my-notes.md");
  });
});
