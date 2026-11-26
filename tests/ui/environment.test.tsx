// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvEntryInput, EnvironmentDoc, EnvWriteResult } from "../../shared/environment";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import { EnvironmentProvider } from "../../src/context/EnvironmentContext";
import type { Api } from "../../src/services/api";
import type { EnvApi } from "../../src/services/environmentClient";

const rec = (Hardware: string, Country: string): DeviceRecord => ({
  sprintNo: "67.00+1",
  Cver: "0.67.00",
  firmwareVersion: "1",
  appVersion: "0.67.00",
  Hardware,
  Country,
});

const DATA: DeviceData = {
  "X117-AL-PORT1-GEN4-FUT-AL_PROD-DVBC": rec("GEN4_SGM", "AL_DVBC"),
  "X117-AL-PORT2-GEN3-MP-AL_PROD-DVBC": rec("GEN3", "AL_DVBC"),
  "X109-CZ-PORT4-GEN4_Mini-FUT-CZ_PROD-OTT": rec("GEN4_Mini_ZTE", "CZ_OTT"),
};

const at = (day: number) => new Date(Date.UTC(2026, 3, day, 9)).toISOString();

function makeDoc(): EnvironmentDoc {
  return {
    version: 1,
    setup: { "X117-AL": { PORT1: [{ at: at(1), by: "meha", note: "Router 3 Port2 · VLAN 202" }] } },
    ports: {
      "X117-AL": { PORT1: [{ at: at(20), by: "meha", status: "issue", category: "ir", note: "no IR backup yet" }] },
      "X109-CZ": {
        PORT4: [
          { at: at(10), by: "sai", status: "down", category: "box", note: "GEN3 box dead" },
          { at: at(12), by: "sai", status: "issue", category: "replaced", note: "Replaced GEN3 with ZTE GEN4_Mini box, IR cable in place" },
        ],
      },
    },
  };
}

function setup({ readOnly = false } = {}) {
  const doc = makeDoc();
  const addEntries = vi.fn(async (inputs: EnvEntryInput[]): Promise<EnvWriteResult> => {
    const now = new Date().toISOString();
    for (const { robot, port, status, category, note, setup } of inputs) {
      if (status) {
        const list = (doc.ports[robot] ??= {})[port] ?? [];
        doc.ports[robot]![port] = [...list, { at: now, by: "me", status, ...(category ? { category } : {}), note: note ?? "" }];
      }
      if (setup !== undefined) {
        const bySetup = ((doc.setup ??= {})[robot] ??= {});
        bySetup[port] = [...(bySetup[port] ?? []), { at: now, by: "me", note: setup }];
      }
    }
    return { doc: structuredClone(doc), version: "v2", fetchedAt: new Date().toISOString(), commit: { sha: "abcdef1234567", message: "Environment" } };
  });
  const env: EnvApi = {
    load: vi.fn(async () => ({ doc: structuredClone(doc), version: "v1", fetchedAt: new Date().toISOString(), readOnly, location: "acme/app@main:environment/environmentStatus.json" })),
    addEntries,
  };
  const devices = {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/devices@main:d.json", authEnabled: false, readOnly: false })),
    getDevices: vi.fn(async () => ({ data: DATA, version: "v1", fetchedAt: new Date().toISOString() })),
  } as unknown as Api;
  render(
    <DeviceDataProvider client={devices}>
      <EnvironmentProvider client={env}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/environment"] })} />
      </EnvironmentProvider>
    </DeviceDataProvider>,
  );
  return { addEntries };
}

async function stageUpdate(user: ReturnType<typeof userEvent.setup>, name: string, status: string, note: string) {
  await user.click(await screen.findByRole("button", { name: `Update ${name}` }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("radio", { name: status }));
  const box = within(dialog).getByLabelText(/Comment|What is the problem/);
  await user.clear(box);
  if (note) await user.type(box, note);
  await user.click(within(dialog).getByRole("button", { name: /to pending|Update pending/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("Environment tab", () => {
  it("is in the top menu and shows problems directly on the cards", async () => {
    setup();
    expect(await screen.findByRole("link", { name: /Device health/ })).toBeInTheDocument();
    const al = await screen.findByRole("region", { name: "X117-AL" });
    expect(within(al).getByText("no IR backup yet")).toBeInTheDocument();
    expect(within(al).getByText("1 problem")).toBeInTheDocument();
    expect(within(al).getByText("No report")).toBeInTheDocument(); // PORT2 has no entries
    const cz = screen.getByRole("region", { name: "X109-CZ" });
    expect(within(cz).getByText(/Replaced GEN3 with ZTE/)).toBeInTheDocument(); // latest entry wins
    expect(within(cz).queryByText("GEN3 box dead")).not.toBeInTheDocument();
  });

  it("filters by one environment at a time", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "X117-AL" });
    const envs = screen.getByRole("radiogroup", { name: "Environment" });
    const labels = within(envs).getAllByRole("radio").map((r) => r.textContent ?? "");
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^All environments3/); // 3 ports
    expect(labels[1]).toMatch(/^AL2/);
    expect(labels[2]).toMatch(/^CZ1/);

    await user.click(within(envs).getByRole("radio", { name: /^CZ/ }));
    expect(screen.queryByRole("region", { name: "X117-AL" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "X109-CZ" })).toBeInTheDocument();
  });

  it("filters by the Issue / Down tiles (no separate 'problems' tile)", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "X117-AL" });
    const tiles = within(screen.getByRole("radiogroup", { name: "Status" }));
    expect(tiles.getAllByRole("radio").map((r) => r.textContent?.replace(/\d+$/, ""))).toEqual(["All ports", "Down", "Issue", "OK / no report"]);
    await user.click(tiles.getByRole("radio", { name: /^Issue/ }));
    expect(screen.queryByText("No report")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3 ports")).toBeInTheDocument();
  });

  it("collects updates as pending and pushes them together in one save", async () => {
    const { addEntries } = setup();
    const user = userEvent.setup();
    const push = await screen.findByRole("button", { name: "Push" });
    expect(push).toBeDisabled(); // nothing pending → not highlighted

    await user.click(await screen.findByRole("button", { name: "Update X117-AL PORT2" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Down" }));
    await user.selectOptions(within(dialog).getByLabelText("Issue type"), "bluetooth");
    await user.type(within(dialog).getByLabelText(/What is the problem/), "BT pairing failed after reboot");
    await user.click(within(dialog).getByRole("button", { name: "Add to pending" }));
    expect(addEntries).not.toHaveBeenCalled(); // nothing saved yet

    await stageUpdate(user, "X109-CZ PORT4", "OK", "IR cable fixed");
    expect(screen.getByRole("region", { name: "Pending updates" })).toHaveTextContent("2 pending updates");
    const al = screen.getByRole("region", { name: "X117-AL" });
    expect(within(al).getByText("BT pairing failed after reboot")).toBeInTheDocument();
    expect(within(al).getByText("Pending")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Push 2 updates" }));
    const review = await screen.findByRole("dialog");
    expect(within(review).getAllByRole("listitem")).toHaveLength(2);
    await user.click(within(review).getByRole("button", { name: "Push 2 updates" }));

    await waitFor(() => expect(addEntries).toHaveBeenCalledTimes(1)); // one commit for both
    expect(addEntries.mock.calls[0]![0]).toEqual([
      { robot: "X109-CZ", port: "PORT4", status: "ok", note: "IR cable fixed" }, // OK = comment, no issue type
      { robot: "X117-AL", port: "PORT2", status: "down", category: "bluetooth", note: "BT pairing failed after reboot" },
    ]);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Pending updates" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
    expect(within(screen.getByRole("region", { name: "X117-AL" })).getByText("2 problems")).toBeInTheDocument();
  });

  it("lets a pending update be undone, removed from the push, or all discarded", async () => {
    const { addEntries } = setup();
    const user = userEvent.setup();
    await stageUpdate(user, "X117-AL PORT2", "Issue", "first");
    await user.click(screen.getByRole("button", { name: "Undo pending update of X117-AL PORT2" }));
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();

    await stageUpdate(user, "X117-AL PORT2", "Issue", "second");
    await stageUpdate(user, "X109-CZ PORT4", "OK", "");
    await user.click(screen.getByRole("button", { name: "Push 2 updates" }));
    const review = await screen.findByRole("dialog");
    await user.click(within(review).getByRole("button", { name: "Remove X109-CZ PORT4 from this push" }));
    expect(within(review).getAllByRole("listitem")).toHaveLength(1);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Discard all" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard all" }));
    expect(screen.getByRole("button", { name: "Push" })).toBeDisabled();
    expect(addEntries).not.toHaveBeenCalled();
  });

  it("requires a description before adding an issue", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Update X117-AL PORT2" }));
    const dialog = await screen.findByRole("dialog");
    const add = () => within(dialog).getByRole("button", { name: "Add to pending" });
    expect(add()).toBeDisabled(); // nothing changed yet
    await user.click(within(dialog).getByRole("radio", { name: "Issue" }));
    expect(add()).toBeDisabled(); // an issue needs a description
    await user.type(within(dialog).getByLabelText(/What is the problem/), "Remote not pairing");
    expect(add()).toBeEnabled();
  });

  it("asks for an issue type only for Issue and Down", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Update X117-AL PORT2" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Issue type")).not.toBeInTheDocument(); // starts as OK
    await user.click(within(dialog).getByRole("radio", { name: "Issue" }));
    expect(within(dialog).getByLabelText("Issue type")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "OK" }));
    expect(within(dialog).queryByLabelText("Issue type")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Comment/)).toBeInTheDocument();
  });

  it("always shows setup info next to the latest status", async () => {
    setup();
    const al = await screen.findByRole("region", { name: "X117-AL" });
    expect(within(al).getByText("Router 3 Port2 · VLAN 202")).toBeInTheDocument();
    expect(within(al).getByText("no IR backup yet")).toBeInTheDocument();
  });

  it("can change only the setup info, keeping the status as it is", async () => {
    const { addEntries } = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Update X117-AL PORT1" }));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(/Setup info/);
    expect(field).toHaveValue("Router 3 Port2 · VLAN 202");
    await user.clear(field);
    await user.type(field, "Router 4 Port1 · VLAN 202");
    await user.click(within(dialog).getByRole("button", { name: "Add to pending" }));

    await user.click(screen.getByRole("button", { name: "Push 1 update" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Push 1 update" }));
    await waitFor(() => expect(addEntries).toHaveBeenCalledTimes(1));
    expect(addEntries.mock.calls[0]![0]).toEqual([{ robot: "X117-AL", port: "PORT1", setup: "Router 4 Port1 · VLAN 202" }]);
    const al = screen.getByRole("region", { name: "X117-AL" });
    expect(await within(al).findByText("Router 4 Port1 · VLAN 202")).toBeInTheDocument();
    expect(within(al).getByText("no IR backup yet")).toBeInTheDocument(); // status untouched
  });

  it("shows the full history, newest first", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "History of X109-CZ PORT4" }));
    const dialog = await screen.findByRole("dialog");
    const items = within(dialog).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // (setup changes appear in the same timeline — covered by the setup tests)
    expect(items[0]).toHaveTextContent("Replaced GEN3 with ZTE");
    expect(items[0]).toHaveTextContent("Current");
    expect(items[1]).toHaveTextContent("GEN3 box dead");
    expect(items[0]).toHaveTextContent("by sai"); // who made each change is shown on every entry
  });

  it("lists issues in a column in the table view", async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "X117-AL" });
    await user.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Issue type" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Issues" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Category" })).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "no IR backup yet" })).toBeInTheDocument();
  });

  it("hides updating for people without write access", async () => {
    setup({ readOnly: true });
    await screen.findByText("You can view the device health status but not update it");
    await screen.findByRole("region", { name: "X117-AL" });
    expect(screen.queryByRole("button", { name: /^Update X/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Push/ })).not.toBeInTheDocument();
    expect(screen.getByText("You can view the device health status but not update it")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History of X109-CZ PORT4" })).toBeInTheDocument();
  });
});
