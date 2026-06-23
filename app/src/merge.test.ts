import { describe, expect, it } from "vitest";
import { mergeText, resolveRegions } from "./merge";

describe("mergeText", () => {
  it("returns the base unchanged when nobody edited", () => {
    const base = "line one\nline two\nline three";
    const result = mergeText(base, base, base);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(base);
    expect(result.conflicts).toHaveLength(0);
  });

  it("takes our change when only we edited", () => {
    const base = "alpha\nbeta\ngamma";
    const ours = "alpha\nBETA EDITED\ngamma";
    const result = mergeText(base, ours, base);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(ours);
  });

  it("takes their change when only they edited", () => {
    const base = "alpha\nbeta\ngamma";
    const theirs = "alpha\nbeta\nGAMMA EDITED";
    const result = mergeText(base, base, theirs);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(theirs);
  });

  it("merges non-overlapping edits from both sides cleanly", () => {
    const base = "title\n\nintro paragraph\n\nbody paragraph\n\nconclusion";
    // We edit the intro; they edit the conclusion. Different parts.
    const ours = "title\n\nINTRO REWRITTEN\n\nbody paragraph\n\nconclusion";
    const theirs =
      "title\n\nintro paragraph\n\nbody paragraph\n\nCONCLUSION REWRITTEN";
    const result = mergeText(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(
      "title\n\nINTRO REWRITTEN\n\nbody paragraph\n\nCONCLUSION REWRITTEN",
    );
    expect(result.conflicts).toHaveLength(0);
  });

  it("merges insertions at different locations cleanly", () => {
    const base = "one\ntwo\nthree";
    const ours = "zero\none\ntwo\nthree";
    const theirs = "one\ntwo\nthree\nfour";
    const result = mergeText(base, ours, theirs);
    expect(result.clean).toBe(true);
    expect(result.text).toBe("zero\none\ntwo\nthree\nfour");
  });

  it("reports a conflict when both sides edit the same line differently", () => {
    const base = "alpha\nbeta\ngamma";
    const ours = "alpha\nOUR BETA\ngamma";
    const theirs = "alpha\nTHEIR BETA\ngamma";
    const result = mergeText(base, ours, theirs);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      ours: ["OUR BETA"],
      base: ["beta"],
      theirs: ["THEIR BETA"],
    });
  });

  it("does not conflict when both sides make the identical edit", () => {
    const base = "alpha\nbeta\ngamma";
    const same = "alpha\nSAME EDIT\ngamma";
    const result = mergeText(base, same, same);
    expect(result.clean).toBe(true);
    expect(result.text).toBe(same);
  });

  it("keeps unaffected regions stable around a conflict", () => {
    const base = "header\nshared line\nfooter";
    const ours = "header\nours line\nfooter";
    const theirs = "header\ntheirs line\nfooter";
    const result = mergeText(base, ours, theirs);
    expect(result.clean).toBe(false);
    // The conflict marker text still contains the untouched header/footer.
    expect(result.text).toContain("header");
    expect(result.text).toContain("footer");
    expect(result.text).toContain("<<<<<<<");
    expect(result.text).toContain(">>>>>>>");
  });

  it("preserves a trailing newline", () => {
    const base = "a\nb\n";
    const ours = "a\nb edited\n";
    const result = mergeText(base, ours, base);
    expect(result.clean).toBe(true);
    expect(result.text).toBe("a\nb edited\n");
  });

  it("handles two separate conflicts in one document", () => {
    const base = "p1\np2\np3\np4\np5";
    const ours = "P1-ours\np2\np3\np4\nP5-ours";
    const theirs = "P1-theirs\np2\np3\np4\nP5-theirs";
    const result = mergeText(base, ours, theirs);
    expect(result.clean).toBe(false);
    expect(result.conflicts).toHaveLength(2);
  });
});

describe("resolveRegions", () => {
  const base = "header\nshared\nfooter";
  const ours = "header\nours line\nfooter";
  const theirs = "header\ntheirs line\nfooter";

  it("keeps our side when chosen", () => {
    const { regions } = mergeText(base, ours, theirs);
    expect(resolveRegions(regions, ["ours"])).toBe("header\nours line\nfooter");
  });

  it("keeps their side when chosen", () => {
    const { regions } = mergeText(base, ours, theirs);
    expect(resolveRegions(regions, ["theirs"])).toBe(
      "header\ntheirs line\nfooter",
    );
  });

  it("keeps both sides when chosen, ours first", () => {
    const { regions } = mergeText(base, ours, theirs);
    expect(resolveRegions(regions, ["both"])).toBe(
      "header\nours line\ntheirs line\nfooter",
    );
  });

  it("resolves multiple conflicts independently and defaults to ours", () => {
    const b = "p1\np2\np3\np4\np5";
    const o = "P1-ours\np2\np3\np4\nP5-ours";
    const t = "P1-theirs\np2\np3\np4\nP5-theirs";
    const { regions } = mergeText(b, o, t);
    // Pick theirs for the first conflict; leave the second to default (ours).
    expect(resolveRegions(regions, ["theirs"])).toBe(
      "P1-theirs\np2\np3\np4\nP5-ours",
    );
  });
});
