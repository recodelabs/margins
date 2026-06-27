import { describe, expect, it } from "vitest";
import {
  isExternalAssetRef,
  relativeAssetRef,
  resolveRepoAssetPath,
} from "./asset-path";

describe("isExternalAssetRef", () => {
  it("flags absolute URLs, protocol-relative, data URLs, anchors, and empty", () => {
    expect(isExternalAssetRef("https://example.com/x.png")).toBe(true);
    expect(isExternalAssetRef("//cdn/x.png")).toBe(true);
    expect(isExternalAssetRef("data:image/png;base64,AAA")).toBe(true);
    expect(isExternalAssetRef("#section")).toBe(true);
    expect(isExternalAssetRef("")).toBe(true);
  });
  it("treats repo-relative refs as internal", () => {
    expect(isExternalAssetRef("assets/x.png")).toBe(false);
    expect(isExternalAssetRef("./assets/x.png")).toBe(false);
    expect(isExternalAssetRef("../assets/x.png")).toBe(false);
    expect(isExternalAssetRef("/assets/x.png")).toBe(false);
  });
});

describe("resolveRepoAssetPath", () => {
  it("resolves root-level documents", () => {
    expect(resolveRepoAssetPath("test.md", "assets/x.png")).toBe(
      "assets/x.png",
    );
    expect(resolveRepoAssetPath("test.md", "./assets/x.png")).toBe(
      "assets/x.png",
    );
  });
  it("resolves ../ from a subfolder document back to repo root", () => {
    expect(resolveRepoAssetPath("project/test.md", "../assets/x.png")).toBe(
      "assets/x.png",
    );
    expect(resolveRepoAssetPath("a/b/test.md", "../../assets/x.png")).toBe(
      "assets/x.png",
    );
  });
  it("resolves a bare relative ref against the document's folder", () => {
    expect(resolveRepoAssetPath("project/test.md", "img/x.png")).toBe(
      "project/img/x.png",
    );
    // Faithfully mirrors github.com: ./assets from a subfolder is doc-relative.
    expect(resolveRepoAssetPath("project/test.md", "./assets/x.png")).toBe(
      "project/assets/x.png",
    );
  });
  it("treats a leading slash as repo-root-relative", () => {
    expect(resolveRepoAssetPath("project/test.md", "/assets/x.png")).toBe(
      "assets/x.png",
    );
  });
  it("returns null for external references", () => {
    expect(resolveRepoAssetPath("test.md", "https://x/y.png")).toBeNull();
    expect(
      resolveRepoAssetPath("test.md", "data:image/png;base64,AA"),
    ).toBeNull();
  });
});

describe("relativeAssetRef", () => {
  it("returns a bare ref for a root-level document", () => {
    expect(relativeAssetRef("test.md", "assets/x.png")).toBe("assets/x.png");
  });
  it("walks up out of subfolders", () => {
    expect(relativeAssetRef("project/test.md", "assets/x.png")).toBe(
      "../assets/x.png",
    );
    expect(relativeAssetRef("a/b/test.md", "assets/x.png")).toBe(
      "../../assets/x.png",
    );
  });
  it("uses the shared prefix when the asset is under the doc's folder", () => {
    expect(relativeAssetRef("docs/test.md", "docs/img/x.png")).toBe(
      "img/x.png",
    );
  });
  it("round-trips: resolve(relativeAssetRef(doc, asset)) === asset", () => {
    const cases: Array<[string, string]> = [
      ["test.md", "assets/x.png"],
      ["project/test.md", "assets/x.png"],
      ["a/b/c/test.md", "assets/deep/y.png"],
      ["docs/test.md", "docs/img/x.png"],
    ];
    for (const [doc, asset] of cases) {
      const ref = relativeAssetRef(doc, asset);
      expect(resolveRepoAssetPath(doc, ref)).toBe(asset);
    }
  });
});
