import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubDocNav } from "./DocumentWorkspace";
import { FileTreeSidebar } from "./FileTreeSidebar";
import type { FileMeta } from "./github-tree";
import type { StorageBackend } from "./storage";

let container: HTMLDivElement;
let root: Root;

const PATHS: FileMeta[] = [
  { path: "README.md", size: 100 },
  { path: "docs/intro.md", size: 200 },
  { path: "docs/design/plan.md", size: 300 },
];

function makeBackend(
  paths: FileMeta[] = PATHS,
  kind: StorageBackend["info"]["kind"] = "github",
): StorageBackend {
  return {
    info: { kind, label: "", detail: "" },
    listMarkdownPaths: async () => paths,
  } as unknown as StorageBackend;
}

const NAV: GitHubDocNav = {
  owner: "octo",
  repo: "demo",
  branch: "main",
  path: "docs/intro.md",
};

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(node);
    // Flush the async listMarkdownPaths microtasks.
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  localStorage.clear();
});

describe("FileTreeSidebar", () => {
  it("renders nothing outside GitHub mode", async () => {
    await render(
      <FileTreeSidebar
        backend={makeBackend(PATHS, "local-files")}
        githubNav={NAV}
        onNavigate={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-testid="file-tree-sidebar"]'),
    ).toBeNull();
  });

  it("renders the repo's top-level tree", async () => {
    await render(
      <FileTreeSidebar
        backend={makeBackend()}
        githubNav={NAV}
        onNavigate={() => {}}
      />,
    );
    expect(
      container.querySelector('[data-testid="file-tree-sidebar"]'),
    ).not.toBeNull();
    const labels = [
      ...container.querySelectorAll('[data-testid="file-tree-folder"]'),
    ].map((n) => n.textContent);
    expect(labels.some((l) => l?.includes("docs"))).toBe(true);
    // README.md is a top-level file
    const files = [
      ...container.querySelectorAll(
        '[data-testid="file-tree-sidebar"] [data-testid="file-tree-file"]',
      ),
    ].map((n) => n.textContent);
    expect(files.some((f) => f?.includes("README.md"))).toBe(true);
  });

  it("auto-expands the folder of the open file", async () => {
    await render(
      <FileTreeSidebar
        backend={makeBackend()}
        githubNav={NAV}
        onNavigate={() => {}}
      />,
    );
    // docs/intro.md is open → "docs" folder must be expanded, revealing intro.md
    const fileLabels = [
      ...container.querySelectorAll('ul [data-testid="file-tree-file"]'),
    ].map((n) => n.textContent);
    expect(fileLabels.some((f) => f?.includes("intro.md"))).toBe(true);
  });

  it("auto-expands every ancestor folder of a deeply nested open file", async () => {
    await render(
      <FileTreeSidebar
        backend={makeBackend()}
        githubNav={{ ...NAV, path: "docs/design/plan.md" }}
        onNavigate={() => {}}
      />,
    );
    // Both "docs" and "docs/design" must be expanded so plan.md is visible.
    const expandedFolders = [
      ...container.querySelectorAll('[data-testid="file-tree-folder"]'),
    ]
      .filter((n) => n.getAttribute("data-expanded") === "true")
      .map((n) => n.textContent);
    expect(expandedFolders.some((l) => l?.includes("docs"))).toBe(true);
    expect(expandedFolders.some((l) => l?.includes("design"))).toBe(true);
    const fileLabels = [
      ...container.querySelectorAll('ul [data-testid="file-tree-file"]'),
    ].map((n) => n.textContent);
    expect(fileLabels.some((f) => f?.includes("plan.md"))).toBe(true);
    // The nested file is the highlighted/active one.
    const active = container.querySelector(
      '[data-testid="file-tree-file"][data-active="true"]',
    );
    expect(active?.textContent).toContain("plan.md");
  });

  it("navigates to a clicked file", async () => {
    const onNavigate = vi.fn();
    await render(
      <FileTreeSidebar
        backend={makeBackend()}
        githubNav={NAV}
        onNavigate={onNavigate}
      />,
    );
    const readme = [
      ...container.querySelectorAll('[data-testid="file-tree-file"]'),
    ].find((n) => n.textContent?.includes("README.md")) as HTMLButtonElement;
    act(() => readme.click());
    expect(onNavigate).toHaveBeenCalledWith("/octo/demo/README.md");
  });

  it("collapses to a rail and expands again", async () => {
    await render(
      <FileTreeSidebar
        backend={makeBackend()}
        githubNav={NAV}
        onNavigate={() => {}}
      />,
    );
    const collapseBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="file-tree-collapse"]',
    );
    act(() => collapseBtn?.click());
    // Sidebar panel gone; rail expand button shown.
    expect(
      container.querySelector('[data-testid="file-tree-sidebar"]'),
    ).toBeNull();
    const expandBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="file-tree-expand"]',
    );
    expect(expandBtn).not.toBeNull();
    act(() => expandBtn?.click());
    expect(
      container.querySelector('[data-testid="file-tree-sidebar"]'),
    ).not.toBeNull();
  });
});
