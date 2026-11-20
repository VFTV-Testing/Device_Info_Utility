import { describe, expect, it } from "vitest";
import { buildCommitMessage } from "../../shared/deviceService";
import type { DeviceRecord } from "../../shared/types";

const rec: DeviceRecord = { sprintNo: "1", Cver: "1", firmwareVersion: "1", appVersion: "1", Hardware: "AVSB", Country: "DE" };

describe("buildCommitMessage", () => {
  it("describes a bulk update as an update, listing every record", () => {
    const message = buildCommitMessage(
      [
        { type: "update", key: "X101-GER-PORT1-A", base: rec, values: rec },
        { type: "update", key: "X102-GER-PORT1-A", base: rec, values: rec },
      ],
      "octo",
    );
    const [title, , ...body] = message.split("\n");
    expect(title).toBe("Update device information: 2 records");
    expect(body).toContain("- update: X101-GER-PORT1-A");
    expect(body).toContain("- update: X102-GER-PORT1-A");
    expect(message).toContain("Requested by: octo");
  });

  it("keeps the import wording for mixed changes", () => {
    const title = buildCommitMessage([
      { type: "create", key: "X1-A-PORT1-B", values: rec },
      { type: "update", key: "X2-A-PORT1-B", base: rec, values: rec },
    ]).split("\n")[0];
    expect(title).toBe("Import device information: 1 added, 1 updated");
  });
});
