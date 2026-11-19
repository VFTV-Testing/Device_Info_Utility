export type TokenKind = "key" | "string" | "number" | "punct" | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

const TOKEN_RE = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/g;

/** Lightweight tokenizer for one line of pretty-printed JSON (display only). */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], kind: m[2] ? "key" : "string" });
      if (m[2]) tokens.push({ text: m[2], kind: "punct" });
    } else if (m[3] !== undefined || m[4] !== undefined) {
      tokens.push({ text: m[0], kind: "number" });
    } else if (m[5] !== undefined) {
      tokens.push({ text: m[5], kind: "punct" });
    } else {
      tokens.push({ text: m[0], kind: "plain" });
    }
  }
  return tokens;
}

/** Case-insensitive match start positions of `query` in `text`. */
export function findMatches(text: string, query: string): number[] {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    positions.push(at);
    from = at + needle.length;
  }
  return positions;
}

export interface Segment {
  text: string;
  kind: TokenKind;
  /** Index of the search match this segment belongs to (within the line), or -1. */
  match: number;
}

/** Splits tokens at search-match boundaries so matches can span several tokens. */
export function segmentLine(tokens: Token[], matchStarts: number[], matchLength: number): Segment[] {
  if (matchStarts.length === 0) return tokens.map((t) => ({ ...t, match: -1 }));
  const segments: Segment[] = [];
  let offset = 0;
  for (const token of tokens) {
    let pos = 0;
    while (pos < token.text.length) {
      const absolute = offset + pos;
      const matchIndex = matchStarts.findIndex((s) => absolute >= s && absolute < s + matchLength);
      let end: number;
      if (matchIndex >= 0) {
        end = Math.min(token.text.length, matchStarts[matchIndex]! + matchLength - offset);
      } else {
        const next = matchStarts.find((s) => s > absolute);
        end = next === undefined ? token.text.length : Math.min(token.text.length, next - offset);
      }
      segments.push({ text: token.text.slice(pos, end), kind: token.kind, match: matchIndex });
      pos = end;
    }
    offset += token.text.length;
  }
  return segments;
}
