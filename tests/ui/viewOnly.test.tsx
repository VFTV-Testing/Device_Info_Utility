// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceDataProvider } from "../../src/context/DeviceDataContext";
import { ViewModeContext } from "../../src/context/ViewModeContext";
import { SignInPage } from "../../src/pages/SignInPage";
import { ApiError } from "../../src/services/api";
import { createViewerClient } from "../../src/services/viewerClient";

const rec: DeviceRecord = { sprintNo: "67.00+1", Cver: "0.67.00", firmwareVersion: "1", appVersion: "0.67.00", Hardware: "AVSB", Country: "DE_DVBC" };
const DATA: DeviceData = { "X101-GER-PORT1-AVSB-A": rec, "X102-GER-PORT2-AVSB-B": { ...rec, Country: "PT_MCAST" } };
const TARGET = { owner: "VFTV-Testing", repo: "Configs", branch: "Main", filePath: "AVSB_GEN3_Configs/deviceInformation.json" };

function rawFetch(body = JSON.stringify(DATA, null, 4)) {
  return vi.fn(async () => new Response(body, { status: 200, headers: { etag: '"abc123"' } }));
}

afterEach(cleanup);

describe("Viewer client (no sign-in)", () => {
  it("reads the public file anonymously from raw.githubusercontent.com", async () => {
    const fetchFn = rawFetch();
    const client = createViewerClient(TARGET, fetchFn as unknown as typeof fetch);
    const snapshot = await client.getDevices();
    expect(snapshot.data).toEqual(DATA);
    expect(snapshot.version).toBe("abc123");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://raw.githubusercontent.com/VFTV-Testing/Configs/Main/AVSB_GEN3_Configs/deviceInformation.json");
    expect(JSON.stringify(init)).not.toMatch(/authorization/i); // never sends credentials
  });

  it("reports view-only config and refuses every write", async () => {
    const client = createViewerClient(TARGET, rawFetch() as unknown as typeof fetch);
    const config = await client.getConfig();
    expect(config).toMatchObject({ readOnly: true, viewOnly: true });
    expect(config.user).toBeUndefined();
    await expect(client.updateRecord("X101-GER-PORT1-AVSB-A", rec, rec)).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(client.importRecords("update-existing", [])).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces an invalid file as FILE_INVALID", async () => {
    const client = createViewerClient(TARGET, rawFetch("{ not json") as unknown as typeof fetch);
    await expect(client.getDevices()).rejects.toMatchObject({ code: "FILE_INVALID" });
  });
});

describe("View-only app", () => {
  function renderViewer(path = "/") {
    const exit = vi.fn();
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <ViewModeContext.Provider value={{ exit }}>
        <DeviceDataProvider client={createViewerClient(TARGET, rawFetch() as unknown as typeof fetch)}>
          <RouterProvider router={router} />
        </DeviceDataProvider>
      </ViewModeContext.Provider>,
    );
    return { exit, router };
  }

  it("opens All Devices instead of the editor, and hides every editing control", async () => {
    const { router } = renderViewer("/");
    expect(await screen.findByTestId("record-count")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/devices");
    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByText("You are viewing without signing in")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Device Manager/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add device/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import JSON/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
    // Browsing still works
    expect(screen.getByRole("combobox", { name: "Filter by Robot" })).toBeInTheDocument();
  });

  it("offers 'Sign in to edit' to leave view-only mode", async () => {
    const { exit } = renderViewer("/devices");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Sign in to edit" }));
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe("Sign-in page", () => {
  it("lets people without a GitHub account open the read-only view", async () => {
    const onViewOnly = vi.fn();
    render(<SignInPage target={TARGET} onSignedIn={vi.fn()} onViewOnly={onViewOnly} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /View without signing in/ }));
    expect(onViewOnly).toHaveBeenCalledTimes(1);
  });
});
