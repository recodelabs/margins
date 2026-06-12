# New markdown file in a folder — design

**Date:** 2026-06-12
**Status:** Approved, pending implementation
**Branch:** `feat/new-markdown-file`

## Summary

Add the ability to create a new, blank markdown file inside any folder of a GitHub
repo from the margins picker. Clicking **+ New file** prompts for a filename,
immediately commits a placeholder file to GitHub, and opens it in the standard
document workspace so the user can write a title and start editing. All edits
*after* creation flow through the existing manual-commit ("Commit changes")
workflow — the feature introduces exactly one new commit: the initial create.

## Goals

- Create a new `.md` file in the current picker folder without leaving the app.
- Commit it to GitHub on disk immediately on creation.
- Hand off to the existing editor + manual-commit flow for all subsequent edits.

## Non-goals (YAGNI)

- Renaming or moving existing files (git moves).
- Creating subfolders, or placing the new file anywhere other than the current folder.
- Deleting files.
- Support for non-GitHub backends (local/preview/remote/api).

## Decisions (resolved during brainstorming)

| Question | Decision |
|----------|----------|
| When is it committed? | **Immediately on creation** — the create is itself one commit. Reuses existing read/edit/commit logic untouched afterward. |
| Filename | **Prompt for a name**, pre-filled `untitled.md`, `.md` enforced. The git filename is whatever the user types; it does not auto-rename when they later change the heading. |
| Initial content | `# Untitled\n` — an obvious placeholder heading to replace. |
| After creation | Hand off to the normal **manual-commit** workspace flow. No special behavior. |

## Architecture & flow

```
Picker (current folder)
   │  click "+ New file"
   ▼
Dialog: filename input (pre-filled "untitled.md")
   │  validate: ends ".md", no "/", not already in this folder
   │  submit
   ▼
backend.createMarkdownFile("<currentDir>/<name>", "# Untitled\n")
   │  PUT /repos/{owner}/{repo}/contents/<path>   (NO sha)
   │  commit message: "Create <path>"
   ▼
on success → navigate to <path>  (openFile)
   ▼
DocumentWorkspace reads the now-existing file → normal manual-commit editing
```

### Why "immediate commit" keeps the implementation small

The GitHub Contents API `PUT` with no `sha` *is* a file create. The existing
`DocumentWorkspace` already reads a file by path and edits it through manual
commit. By committing on creation, the new file genuinely exists with a real
`sha` before the workspace opens it, so none of the read/conflict/commit logic
needs to learn about "documents that aren't on disk yet."

## Components & changes

### `src/storage.ts`
- Add `createFile: boolean` to `BackendCapabilities` (default `false`).
- Add `createMarkdownFile(relativePath: string, content: string): Promise<Page>`
  to the `StorageBackend` interface.

### `src/github-backend.ts`
- Set `capabilities.createFile = true`.
- Implement `createMarkdownFile(path, content)`:
  - `PUT` to `${API}/repos/${owner}/${repo}/contents/${path}` with body
    `{ message: "Create ${path}", content: encodeBase64(content), branch }` and
    **no `sha`**.
  - On success: `invalidateCachedUrl(this.contentsUrl(path))`; return the new
    `Page` (id, derived title, content, `version = json.content.sha`).
  - On `422` (path already exists / race): throw a clear "a file with that name
    already exists" error the dialog can show.
  - Enforce the `.md` suffix (consistent with `saveMarkdownFile`).

### Other backends (`local-storage-backend.ts`, `preview-backend.ts`, `remote-backend.ts`, `api-backend.ts`)
- Add `createFile: false` to their capabilities.
- Provide a `createMarkdownFile` stub that rejects with an "unsupported" error
  (mirrors the existing `saveAsset` unsupported pattern). The UI never calls it
  because the button is gated on the capability, but the interface stays honest.

### New pure helper (e.g. `src/new-file-name.ts`)
- `validateNewFileName(name: string, existingNamesInDir: string[]): { ok: true } | { ok: false; error: string }`
  - non-empty, ends in `.md` (case-insensitive),
  - contains no `/`,
  - not already present in `existingNamesInDir` (case-insensitive compare).
- No React — independently unit-testable.

### `src/GitHubPicker.tsx`
- Add a **+ New file** button in the current-folder view (near the breadcrumb /
  above the file list), shown only when a repo is loaded and the backend's
  `createFile` capability is true.
- Dialog (reuse `components/ui/dialog.tsx`):
  - text input pre-filled `untitled.md`, live validation via the helper using
    the current folder's existing file names (derived from `allPaths` /
    `getFolderContents`),
  - submit disabled while invalid or in flight,
  - on submit call `createMarkdownFile`, then `openFile(newPath)`,
  - on error keep the dialog open and show the message inline.

## Error handling

- **Name collision (client-side):** caught by the validation helper before submit.
- **Name collision (race / server-side):** `createMarkdownFile` maps GitHub `422`
  to a friendly message; dialog stays open.
- **Network/auth failure:** surfaced inline in the dialog; user can retry.

## Testing

Follows existing patterns (`github-backend.test.ts`, `GitHubPicker.test.tsx`).

- **`new-file-name.test.ts`** — validation helper: `.md` enforcement, slash
  rejection, empty rejection, case-insensitive collision detection.
- **`github-backend.test.ts`** — `createMarkdownFile`:
  - sends a `PUT` with **no `sha`** and a `Create …` commit message,
  - returns the new `Page` with the server's `sha`,
  - maps `422` to a collision error.
- **`GitHubPicker.test.tsx`** —
  - button hidden until a repo is loaded,
  - dialog validates (bad name disables submit),
  - successful create navigates to the new file path.

## Delivery

- Implemented on `feat/new-markdown-file`.
- Left for review so the user can promote it and update Cloudflare deployment.
