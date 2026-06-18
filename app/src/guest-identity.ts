const KEY = "margins:guest-name";

export function getGuestName(): string {
  try {
    return localStorage.getItem(KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function setGuestName(name: string): void {
  try {
    localStorage.setItem(KEY, name.trim());
  } catch {
    /* ignore */
  }
}
