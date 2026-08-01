import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ExternalDifftoolService } from "../src/externalDifftool";

test("ExternalDifftoolService opens exact endpoint copies with the configured tool", async (context) => {
  const calls: { repository: string; args: readonly string[] }[] = [];
  const service = new ExternalDifftoolService(async (repository, args) => {
    calls.push({ repository, args });
    if (args[0] === "config") {
      return { exitCode: 0, stdout: "Kaleidoscope\n", stderr: "" };
    }
    return { exitCode: 1, stdout: "", stderr: "" };
  });
  context.after(() => service.dispose());

  await service.open({
    repository: "/repository",
    beforePath: "old/../old image.png",
    afterPath: "renamed/new image.png",
    beforeContent: Buffer.from("before"),
    afterContent: Buffer.from("after"),
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    repository: "/repository",
    args: ["config", "--get", "diff.tool"],
  });
  const difftoolArgs = calls[1]?.args;
  assert.ok(difftoolArgs);
  assert.deepEqual(difftoolArgs.slice(0, 4), [
    "difftool",
    "--no-prompt",
    "--no-index",
    "--",
  ]);
  const beforeFile = difftoolArgs[4];
  const afterFile = difftoolArgs[5];
  assert.ok(beforeFile);
  assert.ok(afterFile);
  assert.ok(beforeFile.endsWith("/before/old image.png"));
  assert.ok(afterFile.endsWith("/after/new image.png"));
  assert.equal((await readFile(beforeFile, "utf8")), "before");
  assert.equal((await readFile(afterFile, "utf8")), "after");
});

test("ExternalDifftoolService requires an explicit Git tool configuration", async () => {
  const service = new ExternalDifftoolService(async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }));

  await assert.rejects(
    service.open({
      repository: "/repository",
      beforePath: "file.txt",
      afterPath: "file.txt",
      beforeContent: Buffer.alloc(0),
      afterContent: Buffer.alloc(0),
    }),
    /No Git diff tool is configured/,
  );
});

test("ExternalDifftoolService reports Git launch failures", async (context) => {
  const service = new ExternalDifftoolService(async (_repository, args) =>
    args[0] === "config"
      ? { exitCode: 0, stdout: "broken-tool\n", stderr: "" }
      : { exitCode: 128, stdout: "", stderr: "tool failed" },
  );
  context.after(() => service.dispose());

  await assert.rejects(
    service.open({
      repository: "/repository",
      beforePath: "file.txt",
      afterPath: "file.txt",
      beforeContent: Buffer.from("before"),
      afterContent: Buffer.from("after"),
    }),
    /tool failed/,
  );
});

test("ExternalDifftoolService invokes a configured Git difftool in no-index mode", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-difftool-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "diff.tool", "gitamida-test");
  git(repository, "config", "difftool.gitamida-test.cmd", "true");
  const service = new ExternalDifftoolService();
  context.after(() => service.dispose());

  await service.open({
    repository,
    beforePath: "image.png",
    afterPath: "image.png",
    beforeContent: Buffer.from("before"),
    afterContent: Buffer.from("after"),
  });
});

function git(repository: string, ...args: string[]): void {
  execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
}
