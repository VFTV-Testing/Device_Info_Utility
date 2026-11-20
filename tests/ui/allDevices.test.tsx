// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import type { Api } from "../../src/services/api";

const rec = (sprintNo: string, Hardware = "AVSB"): DeviceRecord => ({
  sprintNo,
  Cver: "0.67.00",
  firmwareVersion: "1",
  appVersion: "0.67.00",
  Hardware,
  Country: "DE_DVBC",
});

const DATA: DeviceData = {
  "X101-GER-PORT1-AVSB-A": rec("67.00+1"),
  "X101-GER-PORT2-AVSB-B": rec("67.00+2"),
  "X102-GER-PORT1-GEN3-C": rec("67.00+1", "GEN3"),
  "X102-GER-PORT2-GEN3-D": { ...rec("68.00+3", "GEN3"), Country: "DE_OTT" },
};

function renderAllDevices() {
  const client = {
    getConfig: vi.fn(async () => ({ storage: "github" as const, location: "acme/devices@main:x.json", authEnabled: false, readOnly: false })),
    getDevices: vi.fn(async () => ({ data: DATA, version: "v1", fetchedAt: new Date().toISOString() })),
  } as unknown as Api;
  render(
    <DeviceDataProvider client={client}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/devices"] })} />
    </DeviceDataProvider>,
  );
}

afterEach(cleanup);

describe("All Devices filters", () => {
  it("filters by one or more sprintNo values, showing how many records each has", async () => {
    renderAllDevices();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("combobox", { name: "Filter by sprintNo" }));
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["67.00+12", "67.00+21", "68.00+31"]); // value + record count

    await user.click(within(list).getByRole("option", { name: /^67\.00\+1/ }));
    expect(await screen.findByText("Showing 2 of 4 records")).toBeInTheDocument();

    await user.click(within(list).getByRole("option", { name: /^68\.00\+3/ }));
    expect(await screen.findByText("Showing 3 of 4 records")).toBeInTheDocument();
  });

  it("treats DE_DVBC and DE_OTT as one country with two stream types", async () => {
    renderAllDevices();
    const user = userEvent.setup();
    expect(await screen.findByText("country")).toHaveAttribute("title", "Germany");
    expect(screen.getByText("country").parentElement).toHaveTextContent("1 country");

    await user.click(screen.getByRole("combobox", { name: "Filter by Country" }));
    const countries = within(await screen.findByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(countries).toEqual(["DE · Germany4"]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("combobox", { name: "Filter by Stream type" }));
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["DVBC3", "OTT1"]);
    await user.click(within(list).getByRole("option", { name: /^OTT/ }));
    expect(await screen.findByText("Showing 1 of 4 records")).toBeInTheDocument();
  });

  it("offers no Device port or Cver filter", async () => {
    renderAllDevices();
    await screen.findByRole("combobox", { name: "Filter by Robot" });
    expect(screen.queryByRole("combobox", { name: "Filter by Device port" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Filter by Cver" })).not.toBeInTheDocument();
    for (const name of ["Platform", "Country", "Stream type", "sprintNo", "appVersion", "firmwareVersion"]) {
      expect(screen.getByRole("combobox", { name: `Filter by ${name}` })).toBeInTheDocument();
    }
  });
});

describe("Filters drive the summary and the JSON link", () => {
  async function filterBySprint(user: ReturnType<typeof userEvent.setup>, sprint: RegExp) {
    await user.click(await screen.findByRole("combobox", { name: "Filter by sprintNo" }));
    await user.click(within(await screen.findByRole("listbox")).getByRole("option", { name: sprint }));
    await user.keyboard("{Escape}");
  }

  it("recalculates the summary panels for the filtered records", async () => {
    renderAllDevices();
    const user = userEvent.setup();
    expect(await screen.findByTestId("record-count")).toHaveAttribute("aria-label", "4 records");
    await filterBySprint(user, /^67\.00\+1/);

    expect(screen.getByTestId("record-count")).toHaveAttribute("aria-label", "2 of 4 records");
    expect(screen.getByText("Filtered")).toBeInTheDocument();
    expect(screen.getByText("platforms").parentElement).toHaveTextContent("2 platforms");
    expect(screen.getByText("sprint build").parentElement).toHaveTextContent("1 sprint build");
    // Platform mix counts follow the filters but keep every platform clickable.
    expect(screen.getByRole("button", { name: /^AVSB/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^GEN3/ })).toHaveTextContent("1");
  });

  it("opens JSON for exactly the filtered records, and keeps the filters on the way back", async () => {
    renderAllDevices();
    const user = userEvent.setup();
    await filterBySprint(user, /^67\.00\+1/);
    await user.click(screen.getByRole("button", { name: "View JSON (2)" }));

    const content = await screen.findByLabelText("deviceInformation.json content");
    expect(screen.getByText("Filtered: 2 of 4 records")).toBeInTheDocument();
    expect(content).toHaveTextContent("X101-GER-PORT1-AVSB-A");
    expect(content).toHaveTextContent("X102-GER-PORT1-GEN3-C");
    expect(content).not.toHaveTextContent("X101-GER-PORT2-AVSB-B");

    await user.click(screen.getByRole("button", { name: "Show whole file" }));
    expect(screen.getByLabelText("deviceInformation.json content")).toHaveTextContent("X101-GER-PORT2-AVSB-B");

    await user.click(screen.getByRole("button", { name: "Back to All Devices" }));
    expect(await screen.findByTestId("record-count")).toHaveAttribute("aria-label", "2 of 4 records");
    expect(screen.getByRole("combobox", { name: "Filter by sprintNo" })).toHaveTextContent("sprintNo: 67.00+1");
  });

  it("shows the whole file when nothing is filtered, and the top menu no longer has a JSON tab", async () => {
    renderAllDevices();
    const user = userEvent.setup();
    await screen.findByTestId("record-count");
    expect(screen.queryByRole("link", { name: /JSON Preview/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View JSON" }));
    const content = await screen.findByLabelText("deviceInformation.json content");
    for (const key of Object.keys(DATA)) expect(content).toHaveTextContent(key);
    expect(screen.queryByText(/^Filtered:/)).not.toBeInTheDocument();
  });
});
