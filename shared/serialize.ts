import type { DeviceData } from "./types";

export interface JsonFormat {
  indent: string;
  eol: "\n" | "\r\n";
  /** Exact whitespace after the closing brace (e.g. "\n", "\r\n\r\n" or ""), kept byte-for-byte. */
  trailer: string;
}

export const DEFAULT_FORMAT: JsonFormat = { indent: "    ", eol: "\n", trailer: "\n" };

/** Detects indentation, line endings and trailing whitespace so saves keep the file's exact formatting. */
export function detectFormat(text: string): JsonFormat {
  const eol: JsonFormat["eol"] = text.includes("\r\n") ? "\r\n" : "\n";
  const indentMatch = /^\{\r?\n([ \t]+)\S/.exec(text);
  const indent = indentMatch?.[1] ?? DEFAULT_FORMAT.indent;
  const trailer = text.length === 0 ? eol : (/\s*$/.exec(text)?.[0] ?? "");
  return { indent, eol, trailer };
}

export function serializeDeviceData(data: DeviceData, format: JsonFormat = DEFAULT_FORMAT): string {
  let text = JSON.stringify(data, null, format.indent);
  if (format.eol === "\r\n") text = text.replace(/\n/g, "\r\n");
  return text + format.trailer;
}
