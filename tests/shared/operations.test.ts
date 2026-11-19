import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyMutations, insertKeyInOrder, validateMutations } from "../../shared/operations";
import { detectFormat, serializeDeviceData } from "../../shared/serialize";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { validateDeviceData, validateNewKeyParts, validateRecordValues } from "../../shared/validation";

const fileText = readFileSync("deviceInformation.json", "utf8");
const realData = JSON.parse(fileText) as DeviceData;
const KEY = "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC";
const original = realData[KEY]!;
const edited: DeviceRecord = { ...original, sprintNo: "68.00+422608.047.00150", Cver: "0.68.00", appVersion: "0.68.00" };

function without<T extends object>(obj: T, key: string): Omit<T, string> {
  const { [key]: _removed, ...rest } = obj as Record<string, unknown>;
  return rest as T;
}

describe("record management", () => {
  it("loads all six properties of a record", () => {
    expect(Object.keys(original)).toEqual(["sprintNo", "Cver", "firmwareVersion", "appVersion", "Hardware", "Country"]);
  });

  it("updates only the selected record and preserves every other record", () => {
    const result = applyMutations(realData, [{ type: "update", key: KEY, base: original, values: edited }]);
    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(1);
    expect(result.data[KEY]).toEqual(edited);
    expect(without(result.data, KEY)).toEqual(without(realData, KEY));
    expect(Object.keys(result.data)).toEqual(Object.keys(realData)); // order preserved
  });

  it("adds a new record without touching existing ones, at its natural position", () => {
    const key = "X101-GER-PORT5-AVSB-NEW-DE_PROD-DVBC";
    const result = applyMutations(realData, [{ type: "create", key, values: edited }]);
    expect(result.data[key]).toEqual(edited);
    const keys = Object.keys(result.data);
    expect(keys.indexOf(key)).toBe(keys.indexOf("X101-GER-PORT4-GEN3-FUT-DE_PROD-DVBC") + 1);
    for (const k of Object.keys(realData)) expect(result.data[k]).toEqual(realData[k]);
  });

  it("rejects creating a duplicate key and never overwrites", () => {
    const result = applyMutations(realData, [{ type: "create", key: KEY, values: edited }]);
    expect(result.conflicts).toEqual([{ key: KEY, reason: "exists", latest: original }]);
    expect(result.data).toBe(realData);
  });

  it("deletes only the selected record", () => {
    const result = applyMutations(realData, [{ type: "delete", key: KEY, base: original }]);
    expect(KEY in result.data).toBe(false);
    expect(result.data).toEqual(without(realData, KEY));
  });

  it("detects that the record changed since it was loaded (no silent overwrite)", () => {
    const someoneElse = { ...realData, [KEY]: { ...original, Country: "DE_OTT" } };
    const result = applyMutations(someoneElse, [{ type: "update", key: KEY, base: original, values: edited }]);
    expect(result.conflicts[0]).toMatchObject({ key: KEY, reason: "modified", latest: { Country: "DE_OTT" } });
    expect(result.data).toBe(someoneElse);
  });

  it("detects that the record was deleted by someone else", () => {
    const result = applyMutations(without(realData, KEY) as DeviceData, [{ type: "update", key: KEY, base: original, values: edited }]);
    expect(result.conflicts).toEqual([{ key: KEY, reason: "missing" }]);
  });

  it("refuses to delete a record that changed since it was loaded", () => {
    const someoneElse = { ...realData, [KEY]: { ...original, Hardware: "GEN3" } };
    expect(applyMutations(someoneElse, [{ type: "delete", key: KEY, base: original }]).conflicts[0]?.reason).toBe("modified");
  });

  it("keeps a concurrent change to an unrelated record", () => {
    const other = "X121-IE-PORT4-AVSB-FUT-IE_PROD-MCAST";
    const latest = { ...realData, [other]: { ...realData[other]!, Cver: "9.99" } };
    const result = applyMutations(latest, [{ type: "update", key: KEY, base: original, values: edited }]);
    expect(result.conflicts).toEqual([]);
    expect(result.data[other]!.Cver).toBe("9.99");
    expect(result.data[KEY]).toEqual(edited);
  });

  it("applies nothing when any change in a batch conflicts (all or nothing)", () => {
    const result = applyMutations(realData, [
      { type: "create", key: "NEW-PORT1-X", values: edited },
      { type: "create", key: KEY, values: edited },
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect("NEW-PORT1-X" in result.data).toBe(false);
  });

  it("treats saving values that are already stored as a no-op, not a conflict", () => {
    const latest = { ...realData, [KEY]: edited };
    const result = applyMutations(latest, [{ type: "update", key: KEY, base: original, values: edited }]);
    expect(result.conflicts).toEqual([]);
    expect(result.changed).toBe(0);
  });

  it("insertKeyInOrder never reorders existing keys", () => {
    const data = { b: original, a: original } as DeviceData;
    expect(Object.keys(insertKeyInOrder(data, "c", original))).toEqual(["b", "a", "c"]);
  });
});

describe("validation", () => {
  it("accepts the real deviceInformation.json", () => {
    expect(validateDeviceData(realData).ok).toBe(true);
  });

  it("rejects arrays, missing properties, non-strings and extra properties", () => {
    expect(validateDeviceData([]).ok).toBe(false);
    const missing = validateDeviceData({ k: { ...without(original, "Cver") } });
    expect(missing.ok === false && missing.errors[0]).toMatch(/missing property "Cver"/);
    const nonString = validateDeviceData({ k: { ...original, Cver: 67 } });
    expect(nonString.ok === false && nonString.errors[0]).toMatch(/"Cver" must be a string/);
    const extra = validateDeviceData({ k: { ...original, Pipeline: "x" } });
    expect(extra.ok === false && extra.errors[0]).toMatch(/unexpected property "Pipeline"/);
  });

  it("requires non-empty, untrimmed-free string values", () => {
    expect(validateRecordValues({ ...original, sprintNo: "" })).toEqual({ sprintNo: "Required" });
    expect(validateRecordValues({ ...original, Cver: " 0.67" })).toHaveProperty("Cver");
    expect(validateRecordValues(original)).toEqual({});
  });

  it("validates new identifier parts", () => {
    expect(validateNewKeyParts({ device: "X200-GER", port: "PORT1", suffix: "AVSB-FUT-DE_PROD-DVBC" }, realData)).toEqual({});
    expect(validateNewKeyParts({ device: "", port: "PORT1", suffix: "A" }, {})).toHaveProperty("device");
    expect(validateNewKeyParts({ device: "X", port: "P1", suffix: "A" }, {})).toHaveProperty("port");
    expect(validateNewKeyParts({ device: "X", port: "PORT1", suffix: "" }, {})).toHaveProperty("suffix");
    expect(validateNewKeyParts({ device: "X-PORT2-Y", port: "PORT1", suffix: "A" }, {})).toHaveProperty("device");
    expect(validateNewKeyParts({ device: "X101-GER", port: "PORT1", suffix: "AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC" }, realData).key).toMatch(
      /already exists/,
    );
  });

  it("validates mutation payloads", () => {
    expect(validateMutations([])).not.toEqual([]);
    expect(validateMutations([{ type: "update", key: KEY, values: original }])).toEqual([
      `Change #1 (${KEY}): the original values are missing`,
    ]);
    expect(validateMutations([{ type: "create", key: "A-PORT1-B", values: { ...original, Hardware: 5 } }])[0]).toMatch(/Hardware/);
  });
});

describe("serialization preserves the file exactly", () => {
  it("round-trips the real file byte-for-byte", () => {
    expect(serializeDeviceData(JSON.parse(fileText) as DeviceData, detectFormat(fileText))).toBe(fileText);
  });

  it("keeps CRLF line endings and tab indentation when the file uses them", () => {
    const text = '{\r\n\t"a": {\r\n\t\t"x": "1"\r\n\t}\r\n}';
    const format = detectFormat(text);
    expect(format).toEqual({ indent: "\t", eol: "\r\n", trailer: "" });
    expect(serializeDeviceData(JSON.parse(text) as DeviceData, format)).toBe(text);
  });

  it("keeps an extra blank line at the end of the file (as in the Configs repo)", () => {
    const text = '{\r\n    "a": {\r\n        "x": "1"\r\n    }\r\n}\r\n\r\n';
    expect(serializeDeviceData(JSON.parse(text) as DeviceData, detectFormat(text))).toBe(text);
  });

  it("never emits a Pipeline property", () => {
    const result = applyMutations(realData, [
      { type: "update", key: KEY, base: original, values: { ...edited, Pipeline: "p" } as unknown as DeviceRecord },
    ]);
    expect(serializeDeviceData(result.data)).not.toMatch(/Pipeline/i);
  });
});
