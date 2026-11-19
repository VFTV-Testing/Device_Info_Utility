// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord, WriteResult } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import type { Api } from "../../src/services/api";

const rec: DeviceRecord = { sprintNo: "67.00+1", Cver: "0.67.00", firmwareVersion: "1", appVersion: "0.67.00", Hardware: "AVSB", Country: "DE_DVBC" };
const DATA: DeviceData = { "X101-GER-PORT1-AVSB-FUT-DE_PROD-DVBC": rec };

function setup(createRecord = vi.fn()) {
  const client = {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/devices@main:deviceInformation.json", authEnabled: false, readOnly: false })),
    getDevices: vi.fn(async () => ({ data: DATA, version: "v1", fetchedAt: new Date().toISOString() })),
    createRecord,
  } as unknown as Api;
  render(
    <DeviceDataProvider client={client}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </DeviceDataProvider>,
  );
  return createRecord;
}

const byId = (id: string) => document.getElementById(id)!;

async function fillIdentifier(device: string, port: string, suffix: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /add new device/i }));
  await user.type(byId("new-device"), device);
  await user.type(byId("new-port"), port);
  await user.type(byId("new-suffix"), suffix);
  return user;
}

afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("Add new device", () => {
  it("shows a live preview of the final key and rejects a duplicate without calling the API", async () => {
    const createRecord = setup();
    const user = await fillIdentifier("X101-GER", "PORT1", "AVSB-FUT-DE_PROD-DVBC");
    expect(screen.getByTestId("key-preview")).toHaveTextContent("X101-GER-PORT1-AVSB-FUT-DE_PROD-DVBC");
    expect(screen.getByText(/already exists — it will not be overwritten/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^add device$/i }));
    expect(createRecord).not.toHaveBeenCalled();
  });

  it("creates a new record with exactly the six properties", async () => {
    const key = "X101-GER-PORT2-GEN3-MP-DE_PROD-DVBC";
    const createRecord = vi.fn(
      async (k: string, values: DeviceRecord): Promise<WriteResult> => ({
        data: { ...DATA, [k]: values },
        version: "v2",
        fetchedAt: new Date().toISOString(),
        commit: { sha: "1234567abc", message: "Add device information: X101-GER PORT2" },
      }),
    );
    setup(createRecord);
    const user = await fillIdentifier("X101-GER", "2", "GEN3-MP-DE_PROD-DVBC");
    await user.click(byId("new-suffix")); // blur port → normalised to PORT2
    expect(byId("new-port")).toHaveValue("PORT2");

    const values: DeviceRecord = { sprintNo: "67.00+2.2405.170", Cver: "0.67.00", firmwareVersion: "2.2405.170", appVersion: "0.67.00", Hardware: "GEN3", Country: "DE_DVBC" };
    for (const [field, value] of Object.entries(values)) {
      await user.type(document.getElementById(`new-${field}`)!, value);
    }
    await user.click(screen.getByRole("button", { name: /^add device$/i }));

    await waitFor(() => expect(createRecord).toHaveBeenCalledWith(key, values));
    expect(await screen.findByTestId("matched-key")).toHaveTextContent(key);
  });
});
