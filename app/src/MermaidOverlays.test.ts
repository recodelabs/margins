/**
 * Regression test for REC-380 — stored XSS via Mermaid diagrams (GitHub-token
 * exfil path).
 *
 * The fix pins BOTH render paths to `securityLevel: "strict"`. Strict makes
 * Mermaid run its own DOMPurify over diagram labels, so a malicious node label
 * like `<img src=x onerror=...>` is rendered inert (the `onerror` handler is
 * stripped) before the SVG is assigned via innerHTML — closing the path that
 * read the repo-write token from sessionStorage["roughneck.gh.token"].
 *
 * Why this is a static guard and not a behavioral "render the malicious diagram"
 * test: Mermaid needs a layout engine (getBBox + more) that jsdom doesn't
 * provide — it hangs/throws under the vitest environment — and @playwright/test
 * isn't part of the unit-test gate. The inert-rendering behavior was instead
 * verified manually in a real browser (Chrome, Mermaid v11): the `<img onerror>`
 * label rendered with the handler stripped and never executed. See the PR.
 *
 * What this guards against is the realistic regression: someone flipping either
 * initializer back to "loose" (or any non-strict level). DOMPurify-on-top was
 * evaluated and rejected — it strips Mermaid's <foreignObject> HTML labels,
 * blanking every flowchart/subgraph node.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tests run with cwd = app/ (the vitest project root).
const repoFile = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("Mermaid render-path hardening (REC-380)", () => {
  it("SPA (MermaidOverlays.tsx) initializes Mermaid with strict, never loose", () => {
    const src = repoFile("src/MermaidOverlays.tsx");
    expect(src).toMatch(/securityLevel:\s*"strict"/);
    expect(src).not.toMatch(/securityLevel:\s*"loose"/);
  });

  it("legacy (assets/roughneck-enhance.js) initializes Mermaid with strict, never loose", () => {
    const src = repoFile("../assets/roughneck-enhance.js");
    expect(src).toMatch(/securityLevel:\s*'strict'/);
    expect(src).not.toMatch(/securityLevel:\s*'loose'/);
  });
});
