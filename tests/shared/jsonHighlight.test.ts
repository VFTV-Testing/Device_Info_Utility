import { describe, expect, it } from "vitest";
import { findMatches, segmentLine, tokenizeLine } from "../../src/utils/jsonHighlight";

describe("JSON preview highlighting", () => {
  it("tokenizes keys, strings and punctuation", () => {
    const tokens = tokenizeLine('    "Cver": "0.67.00",');
    expect(tokens.filter((t) => t.kind !== "plain")).toEqual([
      { text: '"Cver"', kind: "key" },
      { text: ":", kind: "punct" },
      { text: '"0.67.00"', kind: "string" },
      { text: ",", kind: "punct" },
    ]);
    expect(tokens.map((t) => t.text).join("")).toBe('    "Cver": "0.67.00",');
  });

  it("finds case-insensitive matches", () => {
    expect(findMatches("AVSB avsb", "avsb")).toEqual([0, 5]);
    expect(findMatches("abc", "")).toEqual([]);
  });

  it("highlights matches that span several tokens without losing text", () => {
    const line = '"Cver": "0.67"';
    const segments = segmentLine(tokenizeLine(line), findMatches(line, 'r": "0'), 6);
    expect(segments.map((s) => s.text).join("")).toBe(line);
    expect(segments.filter((s) => s.match === 0).map((s) => s.text).join("")).toBe('r": "0');
  });
});
