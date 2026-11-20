// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord, Mutation, WriteResult } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import { ApiError, type Api } from "../../src/services/api";

const rec = (sprint: string, hardware = "AVSB"): DeviceRecord => ({
  sprintNo: `67.00+${sprint}`,
  Cver: "0.67.00",
  firmwareVersion: sprint,
  appVersion: "0.67.00",
  Hardware: hardware,
  Country: "DE_DVBC",
});

const DATA: DeviceData = {
  "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC": rec("422608.047.00150"),
  "X101-GER-PORT2-AVSB-MP-DE_PROD-DVBC": rec("2.2405.170"),
  "X102-GER-PORT1-GEN3-MP-DE_PROD-DVBC": rec("412608.047.00150", "GEN3"),
  "X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC": rec("422608.047.00150"),
  "X106-IE-PORT1-AVSB-FUT-IE_PROD-MCAST": rec("1"),
  // two records share X200-DUP / PORT1
  "X200-DUP-PORT1-AVSB-A": rec("a"),
  "X200-DUP-PORT1-GEN3-B": rec("b", "GEN3"),
};

function fakeClient(overrides: Partial<Api> = {}): Api {
  return {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/devices@main:deviceInformation.json", authEnabled: false, readOnly: false })),
    getDevices: vi.fn(async () => ({ data: DATA, version: "sha1", fetchedAt: new Date().toISOString() })),
    initialize: vi.fn(),
    createRecord: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecord: vi.fn(),
    importRecords: vi.fn(),
    ...overrides,
  } as Api;
}

function renderApp(client: Api, path = "/") {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <DeviceDataProvider client={client}>
      <RouterProvider router={router} />
    </DeviceDataProvider>,
  );
  return router;
}

async function choose(label: "Robot" | "Device port", option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: new RegExp(`^${option}`) }));
  await user.keyboard("{Escape}"); // multi-select lists stay open until closed
}

async function openOptions(label: "Robot" | "Device port"): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox)
    .getAllByRole("option")
    .map((o) => o.getAttribute("aria-label") ?? o.textContent ?? "");
  await user.keyboard("{Escape}");
  return names;
}

afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("Device and Port selection", () => {
  it("offers each device once, from the JSON keys", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Robot" });
    const options = await openOptions("Robot");
    expect(options.map((o) => o.replace(/\d+ ports?$/, ""))).toEqual(["X101-GER", "X102-GER", "X106-IE", "X200-DUP"]);
  });

  it("disables Port until a device is selected, then shows only that device's ports", async () => {
    renderApp(fakeClient());
    const port = await screen.findByRole("combobox", { name: "Device port" });
    expect(port).toBeDisabled();

    await choose("Robot", "X102-GER");
    expect(screen.getByRole("combobox", { name: "Device port" })).toBeEnabled();
    expect(await openOptions("Device port")).toEqual(["PORT1", "PORT3"]);
  });

  it("loads the exact matching record for Device + Port", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Device port", "PORT1");

    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC");
    expect(screen.getByLabelText(/sprintNo/)).toHaveValue("67.00+422608.047.00150");
    expect(screen.getByLabelText(/firmwareVersion/)).toHaveValue("422608.047.00150");
    expect(screen.getByLabelText(/^Platform/)).toHaveValue("AVSB");
    expect(screen.getByLabelText(/^Country/)).toHaveValue("DE_DVBC");
  });

  it("drops ports the newly selected device does not have", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Device port", "PORT2");
    expect(await screen.findByTestId("matched-key")).toBeInTheDocument();

    await choose("Robot", "X101-GER"); // untick
    await choose("Robot", "X102-GER"); // X102-GER has no PORT2
    expect(screen.getByRole("combobox", { name: "Device port" })).toHaveTextContent("Select a device port");
    await waitFor(() => expect(screen.queryByTestId("matched-key")).not.toBeInTheDocument());
  });

  it("lists ports per selected device, so each device can have its own ports", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Robot", "X102-GER");
    expect(screen.getByRole("combobox", { name: "Robot" })).toHaveTextContent("X101-GER, X102-GER");
    const ports = await openOptions("Device port");
    expect(ports).toEqual(["X101-GER PORT1", "X101-GER PORT2", "X102-GER PORT1", "X102-GER PORT3"]);
  });

  it("requires an explicit choice when several records match", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X200-DUP");
    await choose("Device port", "PORT1");

    expect(await screen.findByText(/2 records match X200-DUP PORT1/)).toBeInTheDocument();
    expect(screen.queryByTestId("matched-key")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: "X200-DUP-PORT1-GEN3-B" }));
    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X200-DUP-PORT1-GEN3-B");
    expect(screen.getByLabelText(/^Platform/)).toHaveValue("GEN3");
  });

  it("opens a record directly from an All Devices edit link", async () => {
    renderApp(fakeClient(), `/?key=${encodeURIComponent("X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC")}`);
    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC");
    expect(screen.getByRole("combobox", { name: "Robot" })).toHaveTextContent("X102-GER");
    expect(screen.getByRole("combobox", { name: "Device port" })).toHaveTextContent("PORT3");
  });
});

describe("Pipeline placeholder", () => {
  it("is an empty, optional dropdown with the placeholder text", async () => {
    renderApp(fakeClient());
    const pipeline = await screen.findByLabelText(/Pipeline/);
    expect(pipeline.tagName).toBe("SELECT");
    expect(pipeline).not.toBeRequired();
    expect(pipeline).toHaveValue("");
    const options = within(pipeline).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Select Pipeline (Coming Soon)");
  });

  it("does not influence matching or saving, and never reaches the saved data", async () => {
    const updateRecord = vi.fn(
      async (key: string, _base: DeviceRecord, values: DeviceRecord): Promise<WriteResult> => ({
        data: { ...DATA, [key]: values },
        version: "sha2",
        fetchedAt: new Date().toISOString(),
        commit: { sha: "abcdef1234567", message: "Update device information: X101-GER PORT1" },
      }),
    );
    renderApp(fakeClient({ updateRecord }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Device port", "PORT1");
    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC");

    const user = userEvent.setup();
    const cver = screen.getByLabelText(/^Cver/);
    await user.clear(cver);
    await user.type(cver, "0.68.00");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(1));
    const [key, base, values] = updateRecord.mock.calls[0]!;
    expect(key).toBe("X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC");
    expect(base).toEqual(DATA[key]);
    expect(Object.keys(values)).toEqual(["sprintNo", "Cver", "firmwareVersion", "appVersion", "Hardware", "Country"]);
    expect(values.Cver).toBe("0.68.00");
    expect(JSON.stringify(updateRecord.mock.calls)).not.toMatch(/pipeline/i);
  });
});

describe("Bulk edit with multiple selections", () => {
  const bulkResult = (data: DeviceData): WriteResult => ({
    data,
    version: "sha2",
    fetchedAt: new Date().toISOString(),
    commit: { sha: "abcdef1234567", message: "Update device information: 2 records" },
  });

  it("updates only the filled-in field on every selected record, in one commit", async () => {
    const importRecords = vi.fn(async (_mode: string, mutations: Mutation[]) => {
      const data = { ...DATA };
      for (const m of mutations) if (m.type === "update") data[m.key] = m.values;
      return bulkResult(data);
    });
    renderApp(fakeClient({ importRecords }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Robot", "X102-GER");
    await choose("Device port", "X101-GER PORT1");
    await choose("Device port", "X102-GER PORT1");

    const form = await screen.findByTestId("bulk-edit");
    expect(within(form).getByText(/Bulk edit · 2 of 2 records/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(within(form).getByLabelText(/^Cver/), "0.70.00");
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Unsaved Changes");
    await user.click(within(form).getByRole("button", { name: "Update 2 records" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Update 2 records" }));

    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    const [mode, mutations] = importRecords.mock.calls[0]!;
    expect(mode).toBe("update-existing");
    expect(mutations.map((m) => m.key).sort()).toEqual(["X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC", "X102-GER-PORT1-GEN3-MP-DE_PROD-DVBC"]);
    for (const m of mutations) {
      if (m.type !== "update") throw new Error("expected updates only");
      expect(m.base).toEqual(DATA[m.key]);
      expect(m.values).toEqual({ ...DATA[m.key], Cver: "0.70.00" }); // other fields keep each record's own value
    }
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Saved to GitHub"));
  });

  it("lets a record be left out, and saves nothing on a conflict", async () => {
    const importRecords = vi.fn(async () => {
      throw new ApiError(409, "RECORD_CONFLICT", "changed", {
        conflicts: [{ key: "X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC", reason: "modified" }],
      });
    });
    renderApp(fakeClient({ importRecords }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Robot", "X102-GER");
    await choose("Device port", "X101-GER PORT1");
    await choose("Device port", "X102-GER PORT1");
    await choose("Device port", "X102-GER PORT3");

    const form = await screen.findByTestId("bulk-edit");
    const user = userEvent.setup();
    await user.click(within(form).getByRole("checkbox", { name: "Include X102-GER-PORT1-GEN3-MP-DE_PROD-DVBC" }));
    await user.type(within(form).getByLabelText(/^Country/), "DE_OTT");
    await user.click(within(form).getByRole("button", { name: "Update 2 records" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Update 2 records" }));

    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    const keys = (importRecords.mock.calls[0] as unknown as [string, Mutation[]])[1].map((m) => m.key);
    expect(keys).not.toContain("X102-GER-PORT1-GEN3-MP-DE_PROD-DVBC");
    expect(await within(form).findByText("Nothing was saved")).toBeInTheDocument();
  });

  it("updates exactly the ports picked per device, not every combination", async () => {
    const importRecords = vi.fn(async (_mode: string, mutations: Mutation[]) => {
      const data = { ...DATA };
      for (const m of mutations) if (m.type === "update") data[m.key] = m.values;
      return bulkResult(data);
    });
    renderApp(fakeClient({ importRecords }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X101-GER");
    await choose("Robot", "X102-GER");
    await choose("Device port", "X101-GER PORT2"); // X101 → PORT2 only
    await choose("Device port", "X102-GER PORT3"); // X102 → PORT3 only

    const form = await screen.findByTestId("bulk-edit");
    expect(within(form).getByText(/Bulk edit · 2 of 2 records/)).toBeInTheDocument(); // not every combination
    const a = "X101-GER-PORT2-AVSB-MP-DE_PROD-DVBC";
    const b = "X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC";

    const user = userEvent.setup();
    await user.type(within(form).getByLabelText(/^appVersion/), "0.71.00");

    await user.click(within(form).getByRole("button", { name: "Update 2 records" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Update 2 records" }));

    await waitFor(() => expect(importRecords).toHaveBeenCalledTimes(1));
    const byKey = Object.fromEntries(importRecords.mock.calls[0]![1].map((m) => [m.key, m.type === "update" ? m.values : null]));
    expect(Object.keys(byKey).sort()).toEqual([a, b]);
    expect(byKey[a]).toEqual({ ...DATA[a], appVersion: "0.71.00" });
    expect(byKey[b]).toEqual({ ...DATA[b], appVersion: "0.71.00" });
  });
});

describe("Saving", () => {
  it("shows success only after GitHub confirms the commit", async () => {
    let confirm!: (r: WriteResult) => void;
    const updateRecord = vi.fn(() => new Promise<WriteResult>((resolve) => (confirm = resolve)));
    renderApp(fakeClient({ updateRecord }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X106-IE");
    await choose("Device port", "PORT1");

    const user = userEvent.setup();
    const field = await screen.findByLabelText(/^appVersion/);
    await user.clear(field);
    await user.type(field, "0.70.00");
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Unsaved Changes");

    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Syncing"));
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled(); // no duplicate submissions

    const key = "X106-IE-PORT1-AVSB-FUT-IE_PROD-MCAST";
    await act(async () =>
      confirm({
        data: { ...DATA, [key]: { ...DATA[key]!, appVersion: "0.70.00" } },
        version: "sha2",
        fetchedAt: new Date().toISOString(),
        commit: { sha: "abcdef1234567", message: "Update device information: X106-IE PORT1" },
      }),
    );
    await waitFor(() => expect(screen.getByTestId("sync-status")).toHaveTextContent("Saved to GitHub"));
    await waitFor(() => expect(screen.queryByText(/Unsaved changes ·/)).not.toBeInTheDocument());
  });

  it("shows a conflict and does not report success when the record changed in GitHub", async () => {
    const key = "X106-IE-PORT1-AVSB-FUT-IE_PROD-MCAST";
    const latest = { ...DATA[key]!, Country: "IE_OTT" };
    const updateRecord = vi.fn(async () => {
      throw new ApiError(409, "RECORD_CONFLICT", "changed", { conflicts: [{ key, reason: "modified", latest }] });
    });
    renderApp(fakeClient({ updateRecord }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X106-IE");
    await choose("Device port", "PORT1");

    const user = userEvent.setup();
    const field = await screen.findByLabelText(/^Cver/);
    await user.clear(field);
    await user.type(field, "1.0.0");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Conflict detected/)).toBeInTheDocument();
    expect(within(dialog).getByText("IE_OTT")).toBeInTheDocument();
    expect(screen.getByTestId("sync-status")).toHaveTextContent("Conflict Detected");

    await user.click(within(dialog).getByRole("button", { name: /discard mine, load latest/i }));
    await waitFor(() => expect(screen.getByLabelText(/^Country/)).toHaveValue("IE_OTT"));
  });

  it("blocks saving when a required field is empty", async () => {
    const updateRecord = vi.fn();
    renderApp(fakeClient({ updateRecord }));
    await screen.findByRole("combobox", { name: "Robot" });
    await choose("Robot", "X106-IE");
    await choose("Device port", "PORT1");
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText(/^sprintNo/));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
