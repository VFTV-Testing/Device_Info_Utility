// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvEntryInput, EnvironmentDoc, EnvWriteResult } from "../../shared/environment";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { routes } from "../../src/App";
import { DeviceHealthSync } from "../../src/components/layout/DeviceHealthSync";
import { DeviceDataProvider, useDeviceData } from "../../src/context/DeviceDataContext";
import { EnvironmentProvider } from "../../src/context/EnvironmentContext";
import { ModeratorContext } from "../../src/context/ModeratorContext";
import { SignInPage } from "../../src/pages/SignInPage";
import { ApiError, type Api } from "../../src/services/api";
import type { EnvApi } from "../../src/services/environmentClient";
import { createModeratorDeviceClient, createModeratorEnvClient, readModerator } from "../../src/services/moderator";

const TARGET = { owner: "VFTV-Testing", repo: "Configs", branch: "Main", filePath: "AVSB_GEN3_Configs/deviceInformation.json" };
const rec: DeviceRecord = { sprintNo: "67.00+1", Cver: "0.67.00", firmwareVersion: "1", appVersion: "0.67.00", Hardware: "GEN3", Country: "GR_MCAST" };
const DATA: DeviceData = { "X111-GRE-PORT4-GEN3-FUT-GR_PROD-MCAST": rec };

afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("Moderator sign-in", () => {
  it("checks the key, then signs in with the given name", async () => {
    const onModerator = vi.fn();
    const verifyKey = vi.fn(async () => undefined);
    render(<SignInPage target={TARGET} onSignedIn={vi.fn()} onModerator={onModerator} moderatorEnabled verifyKey={verifyKey} />);
    const user = userEvent.setup();
    expect(screen.queryByLabelText("Pass key")).not.toBeInTheDocument(); // form opens from the card
    await user.click(await screen.findByRole("button", { name: "Sign in as moderator" }));
    const form = await screen.findByRole("form", { name: "Moderator sign-in" });
    const go = within(form).getByRole("button", { name: /Continue/ });
    expect(go).toBeDisabled();
    await user.type(within(form).getByLabelText("Your name"), "Priya");
    await user.type(within(form).getByLabelText("Pass key"), "amber-falcon-7Q4K");
    await user.click(go);
    await waitFor(() => expect(onModerator).toHaveBeenCalledWith({ name: "Priya", key: "amber-falcon-7Q4K", remember: false }));
    expect(verifyKey).toHaveBeenCalledWith("amber-falcon-7Q4K");
    expect(readModerator()).toMatchObject({ name: "Priya" }); // kept for this tab
  });

  it("shows why a wrong key is refused", async () => {
    const onModerator = vi.fn();
    const verifyKey = vi.fn(async () => {
      throw new ApiError(401, "INVALID_KEY", "That moderator key is not valid.");
    });
    render(<SignInPage target={TARGET} onSignedIn={vi.fn()} onModerator={onModerator} moderatorEnabled verifyKey={verifyKey} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign in as moderator" }));
    await user.type(await screen.findByLabelText("Your name"), "Priya");
    await user.type(screen.getByLabelText("Pass key"), "wrong");
    await user.click(screen.getByRole("button", { name: /^Continue/ }));
    expect(await screen.findByText("That moderator key is not valid.")).toBeInTheDocument();
    expect(onModerator).not.toHaveBeenCalled();
  });

  it("offers GitHub, moderator and view-only cards, without a personal access token option", async () => {
    render(<SignInPage target={TARGET} onSignedIn={vi.fn()} onViewOnly={vi.fn()} onModerator={vi.fn()} moderatorEnabled githubEnabled />);
    expect(await screen.findByRole("button", { name: "Sign in with GitHub" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in as moderator" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View without signing in" })).toBeInTheDocument();
    expect(screen.queryByText(/access token/i)).not.toBeInTheDocument();
  });
});

describe("Moderator client", () => {
  it("sends status updates to the helper with the key and the name", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ doc: { version: 1, ports: {} }, version: "v", fetchedAt: "", commit: { sha: "1", message: "m" } }), { status: 201 }));
    const client = createModeratorEnvClient(TARGET, { name: "Priya", key: "k-123", remember: false }, fetchFn as unknown as typeof fetch);
    await client.addEntries([{ robot: "X111-GRE", port: "PORT4", status: "ok", note: "fixed" }]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/environment\/entries$/);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer k-123");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Priya", entries: [{ robot: "X111-GRE", port: "PORT4", status: "ok", note: "fixed" }] });
  });

  it("reads and saves device information through the helper, for the open family", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ data: DATA, version: "v", fetchedAt: "", commit: { sha: "1", message: "m" } }), { status: 200 }));
    const client = createModeratorDeviceClient(TARGET, "linuxstb", { name: "Priya", key: "k-123", remember: false }, fetchFn as unknown as typeof fetch);
    expect(await client.getConfig()).toMatchObject({ readOnly: false, moderator: "Priya" });
    await client.getDevices();
    await client.updateRecord("TES8-GER-STB1-GEN2_PREM-DE_PROD-DVBC", rec, rec);
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toMatch(/devices\/read$/);
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ family: "linuxstb" });
    expect(calls[1]![0]).toMatch(/devices\/write$/);
    expect(new Headers(calls[1]![1].headers).get("Authorization")).toBe("Bearer k-123");
    expect(JSON.parse(String(calls[1]![1].body))).toMatchObject({ name: "Priya", family: "linuxstb", action: "update", key: "TES8-GER-STB1-GEN2_PREM-DE_PROD-DVBC" });
  });
});

describe("Moderator mode", () => {
  function renderModerator(start = "/environment") {
    const doc: EnvironmentDoc = {
      version: 1,
      setup: { "X111-GRE": { PORT4: [{ at: new Date().toISOString(), note: "Router 3 Port2" }] } },
      ports: { "X111-GRE": { PORT4: [{ at: new Date().toISOString(), status: "down", category: "network", note: "No internet on the box." }] } },
    };
    const addEntries = vi.fn(
      async (inputs: EnvEntryInput[]): Promise<EnvWriteResult> => ({ doc, version: "v2", fetchedAt: new Date().toISOString(), commit: { sha: "abc1234", message: `${inputs.length}` } }),
    );
    const env: EnvApi = { load: vi.fn(async () => ({ doc, version: "v1", fetchedAt: new Date().toISOString(), readOnly: false, location: "x" })), addEntries };
    const devices = {
      getConfig: vi.fn(async () => ({ storage: "github" as const, location: "x", authEnabled: true, readOnly: false, moderator: "Priya" })),
      getDevices: vi.fn(async () => ({ data: DATA, version: "v1", fetchedAt: new Date().toISOString() })),
    } as unknown as Api;
    const signOut = vi.fn();
    const router = createMemoryRouter(routes, { initialEntries: [start] });
    render(
      <ModeratorContext.Provider value={{ name: "Priya", signOut }}>
        <DeviceDataProvider client={devices}>
          <EnvironmentProvider client={env}>
            <RouterProvider router={router} />
          </EnvironmentProvider>
        </DeviceDataProvider>
      </ModeratorContext.Provider>,
    );
    return { addEntries, signOut, router };
  }

  it("shows who is signed in and offers the device editor", async () => {
    const { signOut } = renderModerator("/");
    expect(await screen.findByText("Moderator · Priya")).toBeInTheDocument();
    expect(await screen.findByText("Signed in as Priya (moderator)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Device Manager/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Device health/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });

  it("can push a status update but cannot change setup info", async () => {
    const { addEntries } = renderModerator();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Update X111-GRE PORT4" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Setup info/)).toBeDisabled();
    expect(within(dialog).getByText("Set by the team. Moderators can't change it.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("radio", { name: "OK" }));
    const note = within(dialog).getByLabelText(/Comment/);
    await user.clear(note);
    await user.type(note, "Router reset onsite. Internet back.");
    await user.click(within(dialog).getByRole("button", { name: "Add to pending" }));

    await user.click(screen.getByRole("button", { name: "Push 1 update" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Push 1 update" }));
    await waitFor(() => expect(addEntries).toHaveBeenCalledTimes(1));
    expect(addEntries.mock.calls[0]![0]).toEqual([{ robot: "X111-GRE", port: "PORT4", status: "ok", note: "Router reset onsite. Internet back." }]);
  });
});

describe("Device health follows new devices", () => {
  function Add({ keyName }: { keyName: string }) {
    const { createRecord, snapshot } = useDeviceData();
    return snapshot ? <button onClick={() => void createRecord(keyName, rec)}>add</button> : null;
  }

  it("gives a newly added device port a first health entry, once", async () => {
    let data: DeviceData = { ...DATA };
    const devices = {
      getConfig: vi.fn(async () => ({ storage: "github" as const, location: "x", authEnabled: true, readOnly: false })),
      getDevices: vi.fn(async () => ({ data, version: "v1", fetchedAt: new Date().toISOString() })),
      createRecord: vi.fn(async (key: string, values: DeviceRecord) => {
        data = { ...data, [key]: values };
        return { data, version: "v2", fetchedAt: new Date().toISOString(), commit: { sha: "c0ffee1", message: "Add" } };
      }),
    } as unknown as Api;
    const doc: EnvironmentDoc = { version: 1, ports: { "X111-GRE": { PORT4: [{ at: new Date().toISOString(), status: "ok", note: "" }] } } };
    const addEntries = vi.fn(async (): Promise<EnvWriteResult> => ({ doc, version: "e2", fetchedAt: new Date().toISOString(), commit: { sha: "e", message: "m" } }));
    const env: EnvApi = { load: vi.fn(async () => ({ doc, version: "e1", fetchedAt: new Date().toISOString(), readOnly: false, location: "x" })), addEntries };
    render(
      <DeviceDataProvider client={devices}>
        <EnvironmentProvider client={env}>
          <DeviceHealthSync />
          <Add keyName="X125-GER-PORT2-GEN3-FUT-DE_PROD-DVBC" />
        </EnvironmentProvider>
      </DeviceDataProvider>,
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "add" }));
    await waitFor(() => expect(addEntries).toHaveBeenCalledTimes(1));
    expect(addEntries).toHaveBeenCalledWith([{ robot: "X125-GER", port: "PORT2", status: "ok", note: "Device added" }]);
  });
});
