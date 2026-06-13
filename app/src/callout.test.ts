import { describe, expect, it } from "vitest";
import { parseCalloutMarker } from "./callout";

describe("parseCalloutMarker", () => {
  it("detects each callout type", () => {
    for (const type of [
      "note",
      "tip",
      "important",
      "warning",
      "caution",
    ] as const) {
      expect(parseCalloutMarker(`[!${type}] body`)?.type).toBe(type);
    }
  });

  it("is case-insensitive", () => {
    expect(parseCalloutMarker("[!NOTE] hi")?.type).toBe("note");
    expect(parseCalloutMarker("[!Warning] hi")?.type).toBe("warning");
  });

  it("includes one trailing space in the marker length", () => {
    expect(parseCalloutMarker("[!note] body")?.markerLength).toBe(8); // "[!note] "
    expect(parseCalloutMarker("[!note]body")?.markerLength).toBe(7); // no space
  });

  it("matches a bare marker with no body", () => {
    expect(parseCalloutMarker("[!tip]")?.type).toBe("tip");
  });

  it("returns null for non-callout text", () => {
    expect(parseCalloutMarker("just a quote")).toBeNull();
    expect(parseCalloutMarker("[!unknown] x")).toBeNull();
    expect(parseCalloutMarker("text [!note] not at start")).toBeNull();
  });
});
