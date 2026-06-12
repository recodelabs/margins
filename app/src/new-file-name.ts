export type NameValidationResult = { ok: true } | { ok: false; error: string };

/**
 * Validates a proposed new markdown file name for the current folder.
 * Pure and React-free so it can be unit-tested and reused. `existingNamesInDir`
 * is the list of file names (not full paths) already present in the folder the
 * file would be created in.
 */
export function validateNewFileName(
  name: string,
  existingNamesInDir: string[],
): NameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Enter a file name" };
  if (trimmed.includes("/")) {
    return { ok: false, error: "File name can't contain '/'" };
  }
  if (!/\.md$/i.test(trimmed)) {
    return { ok: false, error: "File name must end in .md" };
  }
  const lower = trimmed.toLowerCase();
  if (existingNamesInDir.some((n) => n.toLowerCase() === lower)) {
    return { ok: false, error: "A file with that name already exists here" };
  }
  return { ok: true };
}
