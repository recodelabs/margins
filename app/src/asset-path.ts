// Helpers for resolving asset (image/file) references in Markdown the same way
// GitHub does: relative to the *document's* directory. The editor commits
// uploaded assets to a repo-root `assets/` folder, but a reference is written
// relative to the document so the link works both inside margins and when the
// same `.md` is viewed on github.com.

const EXTERNAL_REF = /^[a-z][a-z0-9+.-]*:/i;

/** Whether `ref` points outside the repo (absolute URL, protocol-relative, anchor). */
export function isExternalAssetRef(ref: string): boolean {
  const trimmed = ref.trim();
  return (
    trimmed === "" ||
    EXTERNAL_REF.test(trimmed) ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("#")
  );
}

const dirSegments = (path: string): string[] => {
  const segments = path.split("/").filter(Boolean);
  segments.pop(); // drop the file name, keep the directory
  return segments;
};

/**
 * Resolve a relative asset reference against the document's location into a
 * repo-root-relative path. Mirrors github.com's resolution of relative
 * image/link paths in rendered Markdown.
 *
 * - `../assets/x.png` from `project/test.md` → `assets/x.png`
 * - `assets/x.png` from `test.md` → `assets/x.png`
 * - `/assets/x.png` (root-relative) → `assets/x.png`
 *
 * Returns null for external references (leave those untouched).
 */
export function resolveRepoAssetPath(
  documentPath: string,
  ref: string,
): string | null {
  if (isExternalAssetRef(ref)) return null;

  const trimmed = ref.trim();
  const base = trimmed.startsWith("/") ? [] : dirSegments(documentPath);
  const resolved = [...base];

  for (const segment of trimmed.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.join("/");
}

/**
 * Compute a document-relative reference (for insertion into Markdown) that
 * points at `assetRepoPath` from a document at `documentPath`.
 *
 * - doc `test.md`, asset `assets/x.png` → `assets/x.png`
 * - doc `project/test.md`, asset `assets/x.png` → `../assets/x.png`
 * - doc `a/b/test.md`, asset `assets/x.png` → `../../assets/x.png`
 */
export function relativeAssetRef(
  documentPath: string,
  assetRepoPath: string,
): string {
  const docDir = dirSegments(documentPath);
  const asset = assetRepoPath.split("/").filter(Boolean);

  let common = 0;
  while (
    common < docDir.length &&
    common < asset.length &&
    docDir[common] === asset[common]
  ) {
    common += 1;
  }

  const ups = docDir.length - common;
  const parts = [...Array(ups).fill(".."), ...asset.slice(common)];
  return parts.join("/") || ".";
}
