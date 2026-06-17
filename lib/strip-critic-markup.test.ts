import { describe, expect, it } from "vitest";
import { stripCriticMarkup } from "./strip-critic-markup";

describe("stripCriticMarkup", () => {
  it("removes standalone comments and their id metadata block", () => {
    const md = 'Hello {>>internal note<<}{id="c1" by="mberg" at="x"} world';
    expect(stripCriticMarkup(md)).toBe("Hello  world");
  });

  it("unwraps a highlighted anchor and drops its attached comment", () => {
    const md = '{==target phrase==}{>>why?<<}{id="c2" by="mberg" at="x"} stays';
    expect(stripCriticMarkup(md)).toBe("target phrase stays");
  });

  it("rejects suggestions: additions removed, deletions removed, substitutions keep the original", () => {
    expect(stripCriticMarkup("a{++ added++}b")).toBe("ab");
    expect(stripCriticMarkup("a{-- removed--}b")).toBe("ab");
    expect(stripCriticMarkup("say {~~hi~>hello~~} there")).toBe("say hi there");
  });

  it("leaves plain markdown untouched", () => {
    const md = "# Title\n\nA normal paragraph with no markup.\n";
    expect(stripCriticMarkup(md)).toBe(md);
  });

  it("removes a comment id block only when it immediately follows a comment", () => {
    // A standalone `{id=...}`-shaped block in prose must NOT be eaten.
    expect(stripCriticMarkup('plain {id="x"} text')).toBe(
      'plain {id="x"} text',
    );
  });

  it("does not swallow a highlight or substitution that immediately follows a comment", () => {
    expect(stripCriticMarkup("{>>comment<<}{==highlighted==} rest")).toBe(
      "highlighted rest",
    );
    expect(stripCriticMarkup("{>>note<<}{~~old~>new~~} text")).toBe("old text");
    // a real metadata block still gets removed with its comment
    expect(stripCriticMarkup('{>>c<<}{id="c1" by="x"} end')).toBe(" end");
  });

  it("drops an unterminated comment so it cannot leak into the public body", () => {
    expect(stripCriticMarkup("A {>>secret note never closed")).toBe("A ");
    // a normal closed comment elsewhere still works alongside it
    expect(stripCriticMarkup("ok {>>done<<} then {>>dangling")).toBe(
      "ok  then ",
    );
  });
});
