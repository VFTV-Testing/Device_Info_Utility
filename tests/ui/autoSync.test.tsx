// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord, DevicesSnapshot } from "../../shared/types";
import { diffData, DeviceDataProvider, useDeviceData } from "../../src/context/DeviceDataContext";
import type { Api } from "../../src/services/api";

const rec = (Cver: string): DeviceRecord => ({
  sprintNo: "67.00+1",
  Cver,
  firmwareVersion: "1",
  appVersion: "0.67.00",
  Hardware: "AVSB",
  Country: "DE_DVBC",
});
const KEY = "X101-GER-PORT1-AVSB-FUT-DE_PROD-DVBC";

function Probe() {
  const { snapshot, autoSyncMs } = useDeviceData();
  return (
    <p>
      <span data-testid="cver">{snapshot?.data[KEY]?.Cver ?? "loading"}</span>
      <span data-testid="interval">{autoSyncMs}</span>
    </p>
  );
}

function setup(versions: DevicesSnapshot[]) {
  let call = 0;
  const getDevices = vi.fn(async () => versions[Math.min(call++, versions.length - 1)]!);
  const client = {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/devices@main:x.json", authEnabled: false, readOnly: false })),
    getDevices,
  } as unknown as Api;
  render(
    <DeviceDataProvider client={client}>
      <Probe />
    </DeviceDataProvider>,
  );
  return getDevices;
}

const snap = (Cver: string, version: string): DevicesSnapshot => ({ data: { [KEY]: rec(Cver) }, version, fetchedAt: new Date().toISOString() });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Auto-sync", () => {
  it("re-reads GitHub every minute by default and shows the new values", async () => {
    const getDevices = setup([snap("0.67.00", "v1"), snap("0.70.00", "v2")]);
    expect(await screen.findByText("0.67.00")).toBeInTheDocument();
    expect(screen.getByTestId("interval")).toHaveTextContent("60000");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getDevices).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("cver")).toHaveTextContent("0.70.00");
  });

  it("does not poll when auto-sync is turned off", async () => {
    localStorage.setItem("dim-auto-sync", "0");
    const getDevices = setup([snap("0.67.00", "v1"), snap("0.70.00", "v2")]);
    expect(await screen.findByText("0.67.00")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(getDevices).toHaveBeenCalledTimes(1);
  });

  it("keeps the last good data when a background sync fails", async () => {
    let call = 0;
    const getDevices = vi.fn(async () => {
      if (call++ === 0) return snap("0.67.00", "v1");
      throw new Error("offline");
    });
    const client = {
      getConfig: vi.fn(async () => ({ storage: "github" as const, location: "x", authEnabled: false, readOnly: false })),
      getDevices,
    } as unknown as Api;
    render(
      <DeviceDataProvider client={client}>
        <Probe />
      </DeviceDataProvider>,
    );
    expect(await screen.findByText("0.67.00")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getDevices).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("cver")).toHaveTextContent("0.67.00");
  });
});

describe("diffData", () => {
  it("counts added, removed and changed records", () => {
    const before: DeviceData = { a: rec("1"), b: rec("1"), c: rec("1") };
    const after: DeviceData = { a: rec("1"), b: rec("2"), d: rec("1") };
    expect(diffData(before, after)).toEqual({ added: 1, removed: 1, changed: 1 });
  });
});
