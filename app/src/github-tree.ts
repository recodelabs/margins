/**
 * Pure helpers for building a folder-drilldown tree from a flat list of
 * markdown file paths (as returned by GitHubBackend.listMarkdownPaths).
 */

export interface FolderEntry {
  kind: "folder";
  name: string;
  /** Full folder path relative to repo root (e.g. "docs/design"). */
  path: string;
}

export interface FileEntry {
  kind: "file";
  name: string;
  /** Full file path relative to repo root (e.g. "docs/design/plan.md"). */
  path: string;
  /** File size in bytes, from the GitHub tree's blob entry. */
  size: number;
}

export type TreeEntry = FolderEntry | FileEntry;

/** A markdown file path plus the metadata the tree listing carries for it. */
export interface FileMeta {
  /** Full file path relative to repo root (e.g. "docs/design/plan.md"). */
  path: string;
  /** File size in bytes. */
  size: number;
}

/**
 * Given a flat list of `.md` files (path + size) and a `currentDir` (empty
 * string = repo root), returns the immediate children at that folder:
 * subfolders that contain at least one `.md` anywhere beneath them, and `.md`
 * files directly in the current folder. Both lists are sorted alphabetically.
 */
export function getFolderContents(
  files: FileMeta[],
  currentDir: string,
): TreeEntry[] {
  const prefix = currentDir ? `${currentDir}/` : "";

  const immediateFiles: FileEntry[] = [];
  const subfolderNames = new Set<string>();

  for (const { path: p, size } of files) {
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length); // path relative to currentDir
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) {
      // Direct child file
      immediateFiles.push({ kind: "file", name: rest, path: p, size });
    } else {
      // It's under a subfolder
      subfolderNames.add(rest.slice(0, slashIdx));
    }
  }

  const folders: FolderEntry[] = [...subfolderNames].sort().map((name) => ({
    kind: "folder",
    name,
    path: prefix + name,
  }));

  const sortedFiles = immediateFiles.sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return [...folders, ...sortedFiles];
}

/** A folder node in a fully-materialised tree, with its children resolved. */
export interface TreeFolderNode {
  kind: "folder";
  name: string;
  /** Full folder path relative to repo root (e.g. "docs/design"). */
  path: string;
  children: TreeNode[];
}

/** A file leaf in a fully-materialised tree. */
export interface TreeFileNode {
  kind: "file";
  name: string;
  /** Full file path relative to repo root (e.g. "docs/design/plan.md"). */
  path: string;
  /** File size in bytes. */
  size: number;
}

export type TreeNode = TreeFolderNode | TreeFileNode;

/**
 * Materialises the whole folder hierarchy from a flat list of files, so a
 * persistent tree view can expand any folder without re-deriving levels. Same
 * ordering as {@link getFolderContents}: at every level, folders (alpha) come
 * before files (alpha). Empty folders never appear because a folder only exists
 * when at least one file lives beneath it.
 */
export function buildTree(files: FileMeta[]): TreeNode[] {
  const buildLevel = (dir: string): TreeNode[] =>
    getFolderContents(files, dir).map((entry) =>
      entry.kind === "folder"
        ? {
            kind: "folder",
            name: entry.name,
            path: entry.path,
            children: buildLevel(entry.path),
          }
        : entry,
    );
  return buildLevel("");
}

/**
 * Splits a folder path into its ancestor segments, each with its full path.
 * The root (empty string) is represented as `{ name: "<repo>", path: "" }` and
 * is NOT included — the caller should prepend the repo label as appropriate.
 *
 * Example: splitPath("docs/design/patterns") →
 *   [{ name: "docs", path: "docs" },
 *    { name: "design", path: "docs/design" },
 *    { name: "patterns", path: "docs/design/patterns" }]
 */
export function splitPath(
  folderPath: string,
): Array<{ name: string; path: string }> {
  if (!folderPath) return [];
  const parts = folderPath.split("/");
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join("/"),
  }));
}
