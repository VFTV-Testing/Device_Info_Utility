import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildDeviceIndex,
  findMatchingKeys,
  getPortsForDevice,
  naturalCompare,
  normalizePort,
  parseDeviceId,
  resolveMatch,
} from "../../shared/deviceId";
import type { DeviceData, DeviceRecord } from "../../shared/types";

const realData = JSON.parse(readFileSync("deviceInformation.json", "utf8")) as DeviceData;
const rec = (n = "1"): DeviceRecord => ({
  sprintNo: n,
  Cver: n,
  firmwareVersion: n,
  appVersion: n,
  Hardware: "AVSB",
  Country: "DE_DVBC",
});

describe("parseDeviceId", () => {
  it("extracts device, port and suffix from the documented example", () => {
    expect(parseDeviceId("X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC")).toEqual({
      key: "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC",
      device: "X101-GER",
      port: "PORT1",
      portNumber: 1,
      suffix: "AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC",
    });
  });

  it.each([
    ["X106-IE-PORT1-AVSB-FUT-IE_PROD-MCAST", "X106-IE", "PORT1"],
    ["X107-POR-PORT4-GEN3-FUT-PT_PROD-MCAST", "X107-POR", "PORT4"],
    ["X102-GER-PORT4-GEN3-FUT_LPDDR_Ray&Fore-DE_PROD-DVBC", "X102-GER", "PORT4"],
    ["X999-NEW-PORT12-HW-PROD", "X999-NEW", "PORT12"],
    ["LAB-RACK-7-PORT3-GEN4", "LAB-RACK-7", "PORT3"],
  ])("parses %s", (key, device, port) => {
    const id = parseDeviceId(key);
    expect(id?.device).toBe(device);
    expect(id?.port).toBe(port);
  });

  it("uses the first PORT segment when the suffix also mentions PORT", () => {
    expect(parseDeviceId("X1-A-PORT2-HW-PORT9-X")).toMatchObject({ device: "X1-A", port: "PORT2", suffix: "HW-PORT9-X" });
  });

  it.each(["", "X101-GER", "X101-GER-PORT1", "PORT1-AVSB", "X101-GER-PORTA-AVSB", "X101-GER-port1-AVSB", "-PORT1-AVSB"])(
    "safely rejects malformed identifier %j",
    (key) => {
      expect(parseDeviceId(key)).toBeNull();
    },
  );

  it("parses every key in the real deviceInformation.json", () => {
    for (const key of Object.keys(realData)) expect(parseDeviceId(key), key).not.toBeNull();
  });
});

describe("device index and dropdown options", () => {
  const index = buildDeviceIndex(realData);

  it("lists each device once, naturally sorted", () => {
    expect(new Set(index.devices).size).toBe(index.devices.length);
    expect(index.devices[0]).toBe("X101-GER");
    expect(index.devices).toContain("X121-IE");
    expect([...index.devices].sort(naturalCompare)).toEqual(index.devices);
  });

  it("matches the devices actually present in the file (no hard-coding)", () => {
    const expected = new Set(Object.keys(realData).map((k) => parseDeviceId(k)!.device));
    expect(new Set(index.devices)).toEqual(expected);
  });

  it("only offers ports that belong to the selected device", () => {
    const data: DeviceData = {
      "A-1-PORT1-X": rec(),
      "A-1-PORT3-X": rec(),
      "B-2-PORT2-X": rec(),
      "A-1-PORT10-X": rec(),
    };
    const idx = buildDeviceIndex(data);
    expect(getPortsForDevice(idx, "A-1")).toEqual(["PORT1", "PORT3", "PORT10"]);
    expect(getPortsForDevice(idx, "B-2")).toEqual(["PORT2"]);
    expect(getPortsForDevice(idx, null)).toEqual([]);
    expect(getPortsForDevice(idx, "missing")).toEqual([]);
  });

  it("collects keys that do not follow the convention instead of crashing", () => {
    const idx = buildDeviceIndex({ "legacy-key": rec(), "A-PORT1-X": rec() });
    expect(idx.unparsed).toEqual(["legacy-key"]);
    expect(idx.devices).toEqual(["A"]);
  });
});

describe("exact key matching", () => {
  const index = buildDeviceIndex(realData);

  it("returns the exact original key for X101-GER / PORT1", () => {
    expect(resolveMatch(index, "X101-GER", "PORT1")).toEqual({
      kind: "single",
      key: "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC",
    });
  });

  it("does not confuse devices that share a prefix", () => {
    const idx = buildDeviceIndex({ "X1-PORT1-A": rec(), "X10-PORT1-B": rec() });
    expect(findMatchingKeys(idx, "X1", "PORT1")).toEqual(["X1-PORT1-A"]);
  });

  it("reports no match", () => {
    expect(resolveMatch(index, "X101-GER", "PORT9")).toEqual({ kind: "none" });
  });

  it("reports every candidate when several records share device + port", () => {
    const idx = buildDeviceIndex({ "D-PORT1-AVSB-DE": rec(), "D-PORT1-GEN3-DE": rec(), "D-PORT2-X": rec() });
    expect(resolveMatch(idx, "D", "PORT1")).toEqual({ kind: "multiple", keys: ["D-PORT1-AVSB-DE", "D-PORT1-GEN3-DE"] });
  });
});

describe("normalizePort", () => {
  it.each([
    ["1", "PORT1"],
    ["port2", "PORT2"],
    ["PORT03", "PORT3"],
    [" Port 4 ", "PORT4"],
  ])("%j → %s", (input, expected) => expect(normalizePort(input)).toBe(expected));

  it.each(["", "0", "PORTX", "P1"])("rejects %j", (input) => expect(normalizePort(input)).toBeNull());
});
