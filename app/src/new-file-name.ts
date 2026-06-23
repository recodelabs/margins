import { isSupportedPath, SUPPORTED_EXTENSIONS } from "./file-types";

export type NameValidationResult = { ok: true } | { ok: false; error: string };

/** "`.md`, `.json`, … or `.fsh`" for the unsupported-extension error message. */
function supportedExtensionsSentence(): string {
  const exts = [...SUPPORTED_EXTENSIONS];
  if (exts.length === 1) return exts[0];
  return `${exts.slice(0, -1).join(", ")} or ${exts[exts.length - 1]}`;
}

/**
 * Validates a proposed new file name for the current folder. Accepts any file
 * type margins can open (`.md`, `.json`, `.yaml`, `.yml`, `.txt`, `.fsh`).
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
  if (!isSupportedPath(trimmed)) {
    return {
      ok: false,
      error: `File name must end in ${supportedExtensionsSentence()}`,
    };
  }
  const lower = trimmed.toLowerCase();
  if (existingNamesInDir.some((n) => n.toLowerCase() === lower)) {
    return { ok: false, error: "A file with that name already exists here" };
  }
  return { ok: true };
}
