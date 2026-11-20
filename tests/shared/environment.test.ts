import { describe, expect, it } from "vitest";
import { EnvironmentService, serializeEnvDoc, validateEntryInput, validateEnvDoc, type EnvironmentDoc } from "../../shared/environment";
import { AppError } from "../../shared/errors";
import type { DeviceFileStore, StoredFile, WriteOptions, WriteOutcome } from "../../shared/storeTypes";

/** In-memory store with the same optimistic-concurrency rules as the real ones. */
class MemoryStore implements DeviceFileStore {
  readonly kind = "local" as const;
  readonly location = "memory";
  readOnly = false;
  text: string | null;
  version = 0;
  writes: WriteOptions[] = [];
  /** Simulates someone else committing just before our next write. */
  sneakIn: ((text: string | null) => string) | null = null;

  constructor(text: string | null = null) {
    this.text = text;
  }

  async read(): Promise<StoredFile | null> {
    return this.text === null ? null : { text: this.text, version: String(this.version) };
  }

  async write(text: string, options: WriteOptions): Promise<WriteOutcome> {
    if (this.sneakIn) {
      this.text = this.sneakIn(this.text);
      this.version++;
      this.sneakIn = null;
    }
    const current = this.text === null ? null : String(this.version);
    if (options.expectedVersion === null && current !== null) throw new AppError(409, "FILE_EXISTS", "exists");
    if (options.expectedVersion !== null && options.expectedVersion !== current) throw new AppError(409, "GITHUB_SHA_CONFLICT", "changed");
    this.text = text;
    this.version++;
    this.writes.push(options);
    return { version: String(this.version), commitSha: `c${this.version}` };
  }
}

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  robot: "X117-AL",
  port: "PORT1",
  status: "issue",
  category: "ir",
  note: "no IR backup yet",
  ...over,
});

describe("EnvironmentService", () => {
  it("creates the file on the first update and records who and when", async () => {
    const store = new MemoryStore(null);
    const service = new EnvironmentService(store);
    expect((await service.getSnapshot()).doc).toEqual({ version: 1, ports: {} });

    const result = await service.addEntry(entry(), "octo");
    expect(store.writes[0]!.expectedVersion).toBeNull();
    expect(store.writes[0]!.message.split("\n")[0]).toBe("Environment: X117-AL PORT1 → Issue (IR)");
    const saved = result.doc.ports["X117-AL"]!["PORT1"]!;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ by: "octo", status: "issue", category: "ir", note: "no IR backup yet" });
    expect(Date.parse(saved[0]!.at)).not.toBeNaN();
  });

  it("appends to the history — earlier entries are kept and the last one is current", async () => {
    const service = new EnvironmentService(new MemoryStore(null));
    await service.addEntry(entry({ status: "down", category: "network", note: "No internet" }), "a");
    const result = await service.addEntry(entry({ status: "ok", category: "network", note: "Router rebooted" }), "b");
    const history = result.doc.ports["X117-AL"]!["PORT1"]!;
    expect(history.map((e) => [e.status, e.by])).toEqual([
      ["down", "a"],
      ["ok", "b"],
    ]);
  });

  it("saves several updates in one commit, each as its own history entry", async () => {
    const store = new MemoryStore(null);
    const service = new EnvironmentService(store);
    const result = await service.addEntries(
      [entry(), entry({ robot: "X109-CZ", port: "PORT4", status: "down", category: "box", note: "dead box" })],
      "octo",
    );
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]!.message.split("\n")[0]).toBe("Environment: 2 updates");
    expect(store.writes[0]!.message).toContain("- X109-CZ PORT4 → Down (Box not working): dead box");
    expect(Object.keys(result.doc.ports).sort()).toEqual(["X109-CZ", "X117-AL"]);
  });

  it("saves nothing when one of several updates is invalid, or a port appears twice", async () => {
    const store = new MemoryStore(null);
    const service = new EnvironmentService(store);
    await expect(service.addEntries([entry(), entry({ robot: "X1", port: "PORT2", note: "" })])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(service.addEntries([entry(), entry({ note: "again" })])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(service.addEntries([])).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(store.writes).toHaveLength(0);
  });

  it("keeps both updates when someone else saved at the same time", async () => {
    const store = new MemoryStore(serializeEnvDoc({ version: 1, ports: {} }));
    const service = new EnvironmentService(store);
    store.sneakIn = () =>
      serializeEnvDoc({ version: 1, ports: { "X109-CZ": { PORT4: [{ at: new Date().toISOString(), status: "issue", category: "replaced", note: "Replaced box" }] } } });
    const result = await service.addEntry(entry(), "me");
    expect(Object.keys(result.doc.ports).sort()).toEqual(["X109-CZ", "X117-AL"]);
  });

  it("refuses invalid updates and read-only stores", async () => {
    const store = new MemoryStore(null);
    const service = new EnvironmentService(store);
    await expect(service.addEntry(entry({ note: "  " }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(service.addEntry(entry({ port: "P1" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(service.addEntry(entry({ status: "broken" }))).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    store.readOnly = true;
    await expect(service.addEntry(entry())).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(store.writes).toHaveLength(0);
  });

  it("stores OK as a plain comment without an issue type", async () => {
    const store = new MemoryStore(null);
    const result = await new EnvironmentService(store).addEntry(entry({ status: "ok", category: "ir", note: "Manual device" }));
    expect(result.doc.ports["X117-AL"]!["PORT1"]![0]).not.toHaveProperty("category");
    expect(store.writes[0]!.message.split("\n")[0]).toBe("Environment: X117-AL PORT1 → OK");
    expect(validateEntryInput(entry({ status: "ok", category: undefined }))).toEqual([]);
    expect(validateEntryInput(entry({ status: "issue", category: undefined }))).toContain("Choose an issue type");
  });

  it("keeps setup info separate from the status, with its own history", async () => {
    const store = new MemoryStore(null);
    const service = new EnvironmentService(store);
    await service.addEntries([{ robot: "X111-GRE", port: "PORT4", setup: "Router 3 Port2" }], "a");
    const result = await service.addEntries(
      [{ robot: "X111-GRE", port: "PORT4", status: "down", category: "network", note: "No internet on the box", setup: "Router 3 Port2 · VLAN 202" }],
      "b",
    );
    expect(result.doc.ports["X111-GRE"]!["PORT4"]).toHaveLength(1);
    expect(result.doc.setup!["X111-GRE"]!["PORT4"]!.map((e) => e.note)).toEqual(["Router 3 Port2", "Router 3 Port2 · VLAN 202"]);
    expect(store.writes[0]!.message.split("\n")[0]).toBe("Environment: X111-GRE PORT4 setup updated");
    expect(store.writes[1]!.message.split("\n")[0]).toBe("Environment: X111-GRE PORT4 → Down (Network / internet), setup updated");
    expect(validateEnvDoc(JSON.parse(store.text!)).ok).toBe(true);
    expect(validateEntryInput({ robot: "X111-GRE", port: "PORT4" })).toContain("Nothing to update");
  });

  it("allows an OK update without a note", () => {
    expect(validateEntryInput(entry({ status: "ok", note: "" }))).toEqual([]);
  });

  it("rejects a malformed file instead of overwriting it", async () => {
    const service = new EnvironmentService(new MemoryStore('{"version":1,"ports":{"X1":{"PORT1":[{"status":"weird"}]}}}'));
    await expect(service.getSnapshot()).rejects.toMatchObject({ code: "FILE_INVALID" });
    await expect(service.addEntry(entry())).rejects.toMatchObject({ code: "FILE_INVALID" });
  });
});

describe("environment file format", () => {
  it("serialises robots and ports in natural order", () => {
    const doc: EnvironmentDoc = {
      version: 1,
      ports: {
        "X117-AL": { PORT10: [], PORT2: [] },
        "X101-GER": { PORT1: [] },
      },
    };
    const text = serializeEnvDoc(doc);
    expect(text.indexOf("X101-GER")).toBeLessThan(text.indexOf("X117-AL"));
    expect(text.indexOf('"PORT2"')).toBeLessThan(text.indexOf('"PORT10"'));
    expect(text.endsWith("\n")).toBe(true);
    expect(validateEnvDoc(JSON.parse(text)).ok).toBe(true);
  });
});
