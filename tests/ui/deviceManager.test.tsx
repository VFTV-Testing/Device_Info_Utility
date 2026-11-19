// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord, WriteResult } from "../../shared/types";
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

async function choose(label: "Device" | "Port", option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: new RegExp(`^${option}`) }));
}

async function openOptions(label: "Device" | "Port"): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const listbox = await screen.findByRole("listbox");
  const names = within(listbox)
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
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
    await screen.findByRole("combobox", { name: "Device" });
    const options = await openOptions("Device");
    expect(options.map((o) => o.replace(/\d+ ports?$/, ""))).toEqual(["X101-GER", "X102-GER", "X106-IE", "X200-DUP"]);
  });

  it("disables Port until a device is selected, then shows only that device's ports", async () => {
    renderApp(fakeClient());
    const port = await screen.findByRole("combobox", { name: "Port" });
    expect(port).toBeDisabled();

    await choose("Device", "X102-GER");
    expect(screen.getByRole("combobox", { name: "Port" })).toBeEnabled();
    expect(await openOptions("Port")).toEqual(["PORT1", "PORT3"]);
  });

  it("loads the exact matching record for Device + Port", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X101-GER");
    await choose("Port", "PORT1");

    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC");
    expect(screen.getByLabelText(/sprintNo/)).toHaveValue("67.00+422608.047.00150");
    expect(screen.getByLabelText(/firmwareVersion/)).toHaveValue("422608.047.00150");
    expect(screen.getByLabelText(/^Hardware/)).toHaveValue("AVSB");
    expect(screen.getByLabelText(/^Country/)).toHaveValue("DE_DVBC");
  });

  it("resets the port when the device changes", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X101-GER");
    await choose("Port", "PORT2");
    expect(await screen.findByTestId("matched-key")).toBeInTheDocument();

    await choose("Device", "X102-GER");
    expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent("Select a port");
    await waitFor(() => expect(screen.queryByTestId("matched-key")).not.toBeInTheDocument());
  });

  it("requires an explicit choice when several records match", async () => {
    renderApp(fakeClient());
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X200-DUP");
    await choose("Port", "PORT1");

    expect(await screen.findByText(/2 records match X200-DUP PORT1/)).toBeInTheDocument();
    expect(screen.queryByTestId("matched-key")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: "X200-DUP-PORT1-GEN3-B" }));
    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X200-DUP-PORT1-GEN3-B");
    expect(screen.getByLabelText(/^Hardware/)).toHaveValue("GEN3");
  });

  it("opens a record directly from an All Devices edit link", async () => {
    renderApp(fakeClient(), `/?key=${encodeURIComponent("X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC")}`);
    expect(await screen.findByTestId("matched-key")).toHaveTextContent("X102-GER-PORT3-AVSB-MP-DE_PROD-DVBC");
    expect(screen.getByRole("combobox", { name: "Device" })).toHaveTextContent("X102-GER");
    expect(screen.getByRole("combobox", { name: "Port" })).toHaveTextContent("PORT3");
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
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X101-GER");
    await choose("Port", "PORT1");
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

describe("Saving", () => {
  it("shows success only after GitHub confirms the commit", async () => {
    let confirm!: (r: WriteResult) => void;
    const updateRecord = vi.fn(() => new Promise<WriteResult>((resolve) => (confirm = resolve)));
    renderApp(fakeClient({ updateRecord }));
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X106-IE");
    await choose("Port", "PORT1");

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
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X106-IE");
    await choose("Port", "PORT1");

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
    await screen.findByRole("combobox", { name: "Device" });
    await choose("Device", "X106-IE");
    await choose("Port", "PORT1");
    const user = userEvent.setup();
    await user.clear(await screen.findByLabelText(/^sprintNo/));
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
