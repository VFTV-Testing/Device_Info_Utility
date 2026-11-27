import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DeviceData, DeviceRecord } from "../../shared/types";
import { ApiError } from "../../src/services/api";
import { createDirectClient, signInWithToken, SignInError } from "../../src/services/githubSession";
import { FakeGitHub } from "./fakeGitHub";

/**
 * Browser-only (GitHub Pages) mode: the page talks to api.github.com directly with
 * each user's own token. These tests run the real client against the fake GitHub API.
 */
const fileText = readFileSync("deviceInformation.json", "utf8").replace(/\n/g, "\r\n") + "\r\n"; // Configs-style CRLF + blank line
const KEY = "X101-GER-PORT1-AVSB-FUT_EMMC_Rayson-DE_PROD-DVBC";
const original = (JSON.parse(fileText) as DeviceData)[KEY]!;
const edited: DeviceRecord = { ...original, Cver: "0.68.00" };
const target = { owner: "VFTV-Testing", repo: "Configs", branch: "Main", filePath: "AVSB_GEN3_Configs/deviceInformation.json" };

function fake() {
  return new FakeGitHub({ owner: target.owner, repo: target.repo, branch: target.branch, path: target.filePath, initialText: fileText });
}

describe("sign-in", () => {
  it("identifies the user and their write access", async () => {
    const gh = fake();
    const session = await signInWithToken("  github_pat_x  ", target, gh.fetch);
    expect(session).toMatchObject({ token: "github_pat_x", login: "tester", canWrite: true });
    expect(gh.requests[0]!.auth).toBe("Bearer github_pat_x");
  });

  it("rejects an invalid token", async () => {
    const gh = fake();
    gh.failure = "auth";
    await expect(signInWithToken("bad", target, gh.fetch)).rejects.toThrow(/rejected this token/);
  });

  it("explains when the token does not include the repository", async () => {
    const gh = new FakeGitHub({ repo: "SomethingElse" });
    await expect(signInWithToken("t", target, gh.fetch)).rejects.toBeInstanceOf(SignInError);
  });

  it("requires a token", async () => {
    await expect(signInWithToken("   ", target, fake().fetch)).rejects.toThrow(/Paste your GitHub token/);
  });
});

describe("direct client", () => {
  it("commits a single-record update as the signed-in user, preserving CRLF and the trailing blank line", async () => {
    const gh = fake();
    const client = createDirectClient(target, await signInWithToken("t", target, gh.fetch), gh.fetch);
    const config = await client.getConfig();
    expect(config).toMatchObject({ user: "tester", readOnly: false, location: "VFTV-Testing/Configs@Main:AVSB_GEN3_Configs/deviceInformation.json" });

    const result = await client.updateRecord(KEY, original, edited);
    expect(result.commit.message).toBe("Update device information: X101-GER PORT1");
    expect(gh.commits[0]!.message).not.toContain("Requested by"); // the commit author is already the user
    const before = fileText.split("\r\n");
    const after = gh.text!.split("\r\n");
    expect(after.filter((line, i) => line !== before[i])).toEqual(['        "Cver": "0.68.00",']);
    expect(gh.text!.endsWith("}\r\n\r\n")).toBe(true);
  });

  it("records the moderator's typed name on commits made with their pass key", async () => {
    const gh = fake();
    const session = { ...(await signInWithToken("t", target, gh.fetch)), moderator: "Ravi" };
    const client = createDirectClient(target, session, gh.fetch);
    expect(await client.getConfig()).toMatchObject({ user: "tester", moderator: "Ravi" });
    await client.updateRecord(KEY, original, edited);
    expect(gh.commits[0]!.message).toContain("Requested by: Ravi (moderator)");
  });

  it("surfaces record conflicts as ApiError RECORD_CONFLICT", async () => {
    const gh = fake();
    const client = createDirectClient(target, await signInWithToken("t", target, gh.fetch), gh.fetch);
    gh.externalCommit(fileText.replace('"Country": "DE_DVBC"', '"Country": "DE_OTT"'));
    const error = await client.updateRecord(KEY, original, edited).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "RECORD_CONFLICT" });
  });

  it("is read-only for users without write access, before any request is sent", async () => {
    const gh = fake();
    gh.canPush = false;
    const session = await signInWithToken("t", target, gh.fetch);
    expect(session.canWrite).toBe(false);
    const client = createDirectClient(target, session, gh.fetch);
    expect((await client.getConfig()).readOnly).toBe(true);
    await expect(client.updateRecord(KEY, original, edited)).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(gh.requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("maps a commit permission error (e.g. branch protection) to a clear message", async () => {
    const gh = fake();
    const client = createDirectClient(target, await signInWithToken("t", target, gh.fetch), gh.fetch);
    gh.beforePut = () => {
      gh.failure = "forbidden";
    };
    await expect(client.updateRecord(KEY, original, edited)).rejects.toMatchObject({ code: "GITHUB_PERMISSION_DENIED" });
    expect(gh.commits).toHaveLength(0);
  });

  it("applies the same import rules as the server", async () => {
    const gh = fake();
    const client = createDirectClient(target, await signInWithToken("t", target, gh.fetch), gh.fetch);
    await expect(client.importRecords("add-only", [{ type: "update", key: KEY, base: original, values: edited }])).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});
