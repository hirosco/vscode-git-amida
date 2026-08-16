import assert from "node:assert/strict";
import test from "node:test";

import { ExternalMergetoolService } from "../src/externalMergetool";

test("ExternalMergetoolService opens one path in the configured merge tool", async () => {
  const calls: { repository: string; args: readonly string[] }[] = [];
  const service = new ExternalMergetoolService(async (repository, args) => {
    calls.push({ repository, args });
    return args[0] === "config"
      ? { exitCode: 0, stdout: "Kaleidoscope\n", stderr: "" }
      : { exitCode: 0, stdout: "", stderr: "" };
  });

  await service.open({
    repository: "/repository",
    path: "src/conflicted file.txt",
    conflict: { status: "UU" },
  });

  assert.deepEqual(calls, [
    {
      repository: "/repository",
      args: ["config", "--get", "merge.tool"],
    },
    {
      repository: "/repository",
      args: [
        "mergetool",
        "--no-prompt",
        "--",
        "src/conflicted file.txt",
      ],
    },
  ]);
});

test("ExternalMergetoolService falls back to merge.guitool", async () => {
  const calls: string[][] = [];
  const service = new ExternalMergetoolService(async (_repository, args) => {
    calls.push([...args]);
    if (args.at(-1) === "merge.tool") {
      return { exitCode: 1, stdout: "", stderr: "" };
    }
    if (args.at(-1) === "merge.guitool") {
      return { exitCode: 0, stdout: "custom-gui\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });

  await service.open({
    repository: "/repository",
    path: "file.txt",
    conflict: { status: "AA" },
  });

  assert.deepEqual(calls.at(-1), [
    "mergetool",
    "--gui",
    "--no-prompt",
    "--",
    "file.txt",
  ]);
});

test("ExternalMergetoolService requires explicit Git configuration", async () => {
  const service = new ExternalMergetoolService(async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "",
  }));

  await assert.rejects(
    service.open({
      repository: "/repository",
      path: "file.txt",
      conflict: { status: "UU" },
    }),
    /No Git merge tool is configured/,
  );
});

test("ExternalMergetoolService reports tool failures", async () => {
  const service = new ExternalMergetoolService(async (_repository, args) =>
    args[0] === "config"
      ? { exitCode: 0, stdout: "broken-tool\n", stderr: "" }
      : { exitCode: 1, stdout: "", stderr: "tool failed" },
  );

  await assert.rejects(
    service.open({
      repository: "/repository",
      path: "file.txt",
      conflict: { status: "UU" },
    }),
    /tool failed/,
  );
});

test("ExternalMergetoolService rejects modify-delete conflicts before Git", async () => {
  let called = false;
  const service = new ExternalMergetoolService(async () => {
    called = true;
    return { exitCode: 0, stdout: "", stderr: "" };
  });

  await assert.rejects(
    service.open({
      repository: "/repository",
      path: "file.txt",
      conflict: { status: "UD" },
    }),
    /does not have both index sides/,
  );
  assert.equal(called, false);
});
