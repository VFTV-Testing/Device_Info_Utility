import { describe, expect, it } from "vitest";
import { analyzeImport, buildImportMutations, findDuplicateRootKeys } from "../../shared/importer";
import type { DeviceData, DeviceRecord } from "../../shared/types";

const rec = (v: string): DeviceRecord => ({
  sprintNo: `67.00+${v}`,
  Cver: "0.67.00",
  firmwareVersion: v,
  appVersion: "0.67.00",
  Hardware: "AVSB",
  Country: "DE_DVBC",
});

const existing: DeviceData = {
  "X1-GER-PORT1-AVSB-DE": rec("1"),
  "X1-GER-PORT2-AVSB-DE": rec("2"),
};

describe("analyzeImport", () => {
  it("classifies new, changed and identical records", () => {
    const file = {
      "X1-GER-PORT1-AVSB-DE": rec("1"), // identical
      "X1-GER-PORT2-AVSB-DE": rec("2b"), // changed
      "X2-GER-PORT1-GEN3-DE": rec("3"), // new
    };
    const a = analyzeImport(JSON.stringify(file), existing);
    expect(a.errors).toEqual([]);
    expect(a.newKeys).toEqual(["X2-GER-PORT1-GEN3-DE"]);
    expect(a.unchanged).toEqual(["X1-GER-PORT1-AVSB-DE"]);
    expect(a.changed).toHaveLength(1);
    expect(a.changed[0]).toMatchObject({ key: "X1-GER-PORT2-AVSB-DE", fields: ["sprintNo", "firmwareVersion"] });
  });

  it("rejects invalid JSON", () => {
    expect(analyzeImport("{ not json", existing).errors[0]).toMatch(/Invalid JSON/);
  });

  it("rejects an array root", () => {
    expect(analyzeImport("[]", existing).errors[0]).toMatch(/not an array/);
  });

  it("rejects a record with a missing property", () => {
    const { Country: _c, ...partial } = rec("1");
    expect(analyzeImport(JSON.stringify({ "A-PORT1-B": partial }), existing).errors[0]).toMatch(/missing property "Country"/);
  });

  it("rejects a non-string property", () => {
    const errors = analyzeImport(JSON.stringify({ "A-PORT1-B": { ...rec("1"), Cver: 0.67 } }), existing).errors;
    expect(errors[0]).toMatch(/"Cver" must be a string/);
  });

  it("rejects extra properties such as Pipeline", () => {
    const errors = analyzeImport(JSON.stringify({ "A-PORT1-B": { ...rec("1"), Pipeline: "x" } }), existing).errors;
    expect(errors[0]).toMatch(/unexpected property "Pipeline"/);
  });

  it("detects duplicate keys that JSON.parse would silently drop", () => {
    const text = `{"A-PORT1-B": ${JSON.stringify(rec("1"))}, "A-PORT1-B": ${JSON.stringify(rec("2"))}}`;
    expect(analyzeImport(text, existing).errors).toContain('Duplicate device identifier in file: "A-PORT1-B"');
  });

  it("only scans root-level keys for duplicates", () => {
    expect(findDuplicateRootKeys(`{"a": {"x": "1"}, "b": {"x": "2"}}`)).toEqual([]);
    expect(findDuplicateRootKeys(`{"a\\"q": 1, "a\\"q": 2}`)).toEqual(['a"q']);
  });

  it("warns about identifiers that do not follow the naming convention", () => {
    expect(analyzeImport(JSON.stringify({ legacy: rec("1") }), existing).warnings[0]).toMatch(/naming convention/);
  });
});

describe("buildImportMutations", () => {
  const file = { "X1-GER-PORT2-AVSB-DE": rec("2b"), "X2-GER-PORT1-GEN3-DE": rec("3") };
  const analysis = analyzeImport(JSON.stringify(file), existing);

  it("add-only creates new records and never updates existing ones", () => {
    const mutations = buildImportMutations(analysis, "add-only");
    expect(mutations).toEqual([{ type: "create", key: "X2-GER-PORT1-GEN3-DE", values: rec("3") }]);
  });

  it("update-existing also updates changed records, guarded by their current values", () => {
    const mutations = buildImportMutations(analysis, "update-existing");
    expect(mutations).toContainEqual({ type: "update", key: "X1-GER-PORT2-AVSB-DE", base: rec("2"), values: rec("2b") });
    expect(mutations).toHaveLength(2);
  });
});
