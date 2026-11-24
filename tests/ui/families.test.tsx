// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizePort, parseDeviceId } from "../../shared/deviceId";
import { setActiveSchema, STB_SCHEMA } from "../../shared/schema";
import type { EnvironmentDoc } from "../../shared/environment";
import type { DeviceData } from "../../shared/types";
import { validateDeviceData, validateNewKeyParts } from "../../shared/validation";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import { EnvironmentProvider } from "../../src/context/EnvironmentContext";
import { FamilyContext } from "../../src/context/FamilyContext";
import { ALL_FAMILIES, findFamily, readFamilyChoice, rememberFamily, type DeviceFamily } from "../../src/families";
import { buildRows } from "../../src/lib/deviceFilters";
import type { Api } from "../../src/services/api";
import type { EnvApi } from "../../src/services/environmentClient";

const mobile = findFamily("mobile", ALL_FAMILIES)!;
const smartTv = findFamily("smarttv", ALL_FAMILIES)!;

const MOBILE_DATA = {
  "X103-GER-PORT1-ANDROID-TABLET": { sprintNo: "S15.6", Cver: "0.15.6", appVersion: "0.45.12" },
  "X110-GER-PORT3-iOS-SMARTPHONE": { sprintNo: "S15.6", Cver: "0.15.6", appVersion: "0.45.12" },
} as unknown as DeviceData;

const TV_DATA = {
  "X122-P1-FireOS-Amazon-AFTGAZL-LE": { sprintNo: "1.17.0.0", firmwareVersion: "", appVersion: "1.17.0.0" },
  "X123-P1-WebOS-LG-43QNED776RB-LE": { sprintNo: "R8.3", firmwareVersion: "", appVersion: "8.3" },
} as unknown as DeviceData;

afterEach(() => {
  cleanup();
  setActiveSchema(STB_SCHEMA);
  window.history.replaceState(null, "", "/");
});

describe("device family rules", () => {
  it("reads Smart TV identifiers written with P1", () => {
    setActiveSchema(smartTv);
    expect(parseDeviceId("X122-P1-FireOS-Amazon-AFTGAZL-LE")).toMatchObject({ device: "X122", port: "P1", suffix: "FireOS-Amazon-AFTGAZL-LE" });
    expect(parseDeviceId("X102-GER-PORT3-GEN4_SGM-FUT_3SS-PT_PROD-OTT")).toBeNull();
    expect(normalizePort("2")).toBe("P2");
    expect(normalizePort("p4")).toBe("P4");
    expect(validateNewKeyParts({ device: "X140", port: "P1", suffix: "Tizen-Samsung-X" }, {})).toEqual({});
  });

  it("keeps STB strict: P1 is not a port there", () => {
    expect(parseDeviceId("X122-P1-FireOS-Amazon-AFTGAZL-LE")).toBeNull();
    expect(normalizePort("2")).toBe("PORT2");
  });

  it("checks each file against its own family's fields", () => {
    setActiveSchema(mobile);
    expect(validateDeviceData(MOBILE_DATA).ok).toBe(true);
    setActiveSchema(smartTv);
    const wrong = validateDeviceData(MOBILE_DATA);
    expect(wrong.ok).toBe(false);
    expect(!wrong.ok && wrong.errors).toContain('"X103-GER-PORT1-ANDROID-TABLET": missing property "firmwareVersion"');
    setActiveSchema(STB_SCHEMA);
    expect(validateDeviceData(TV_DATA).ok).toBe(false);
  });

  it("takes the platform from the identifier when a family has no Hardware field", () => {
    setActiveSchema(mobile);
    const rows = buildRows(MOBILE_DATA);
    expect(rows.map((r) => r.Hardware)).toEqual(["ANDROID", "iOS"]);
    expect(rows[0]).toMatchObject({ device: "X103-GER", port: "PORT1", firmwareVersion: "—", country: "—", kind: "Tablet" });
    expect(rows[1]!.kind).toBe("Phone");
  });

  it("opens the family named in a shared link, else the remembered one", () => {
    expect(readFamilyChoice(ALL_FAMILIES)).toBeNull();
    rememberFamily(mobile);
    expect(readFamilyChoice(ALL_FAMILIES)?.id).toBe("mobile");
    expect(window.location.search).toBe("?family=mobile");
    window.history.replaceState(null, "", "/?view&family=smarttv");
    expect(readFamilyChoice(ALL_FAMILIES)?.id).toBe("smarttv");
    rememberFamily(mobile);
    expect(window.location.search).toBe("?view&family=mobile");
  });
});

function renderFamily(family: DeviceFamily, data: DeviceData, switchTo = vi.fn()) {
  setActiveSchema(family);
  const client = {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/Configs@Main:x.json", authEnabled: false, readOnly: false })),
    getDevices: vi.fn(async () => ({ data, version: "v1", fetchedAt: new Date().toISOString() })),
  } as unknown as Api;
  render(
    <FamilyContext.Provider value={{ family, families: ALL_FAMILIES, switchTo }}>
      <DeviceDataProvider client={client}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/devices"] })} />
      </DeviceDataProvider>
    </FamilyContext.Provider>,
  );
  return switchTo;
}

describe("All Devices per family", () => {
  it("shows only the Mobile fields, with the platform from the identifier", async () => {
    renderFamily(mobile, MOBILE_DATA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Table" }));
    const headers = (await screen.findAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(["sprintNo", "Cver", "appVersion", "Platform"]));
    expect(headers).not.toContain("firmwareVersion");
    expect(headers).not.toContain("Country");
    expect(screen.queryByRole("combobox", { name: "Filter by Country" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by appVersion" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("ANDROID")).toBeInTheDocument();
  });

  it("shows Smart TV firmware and appVersion but no Cver", async () => {
    renderFamily(smartTv, TV_DATA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Table" }));
    const headers = (await screen.findAllByRole("columnheader")).map((h) => h.textContent);
    expect(headers).toContain("firmwareVersion");
    expect(headers).toContain("appVersion");
    expect(headers).not.toContain("Cver");
    expect(within(screen.getByRole("table")).getByText("X122")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByText("P1")).toHaveLength(2);
  });

  it("switches family from the header pill", async () => {
    const switchTo = renderFamily(mobile, MOBILE_DATA);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Device family: Mobile/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /Smart TV/ }));
    expect(switchTo).toHaveBeenCalledWith(smartTv);
  });
});

describe("Environment per family", () => {
  it("lists only the open family's ports, with no issues when none are recorded", async () => {
    setActiveSchema(mobile);
    const doc: EnvironmentDoc = {
      version: 1,
      ports: { "X117-AL": { PORT1: [{ at: new Date().toISOString(), by: "sai", status: "issue", category: "ir", note: "no IR backup yet" }] } },
    };
    const env: EnvApi = {
      load: vi.fn(async () => ({ doc, version: "v1", fetchedAt: new Date().toISOString(), readOnly: true, location: "acme/app@main:env.json" })),
      addEntries: vi.fn(),
    };
    const client = {
      getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/Configs@Main:x.json", authEnabled: false, readOnly: true, viewOnly: true })),
      getDevices: vi.fn(async () => ({ data: MOBILE_DATA, version: "v1", fetchedAt: new Date().toISOString() })),
    } as unknown as Api;
    render(
      <DeviceDataProvider client={client}>
        <EnvironmentProvider client={env}>
          <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/environment"] })} />
        </EnvironmentProvider>
      </DeviceDataProvider>,
    );
    expect(await screen.findByText("X103-GER")).toBeInTheDocument();
    expect(screen.getByText("X110-GER")).toBeInTheDocument();
    expect(screen.queryByText("X117-AL")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Environment" })).not.toBeInTheDocument();
  });
});

describe("Smart TV wording", () => {
  it("calls the platform OS", async () => {
    renderFamily(smartTv, TV_DATA);
    expect(await screen.findByText("OS mix")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter by OS" })).toBeInTheDocument();
    expect(screen.queryByText("Platform mix")).not.toBeInTheDocument();
  });
});
