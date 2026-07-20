import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitClient, parseHistory, parseNameStatus } from "../src/git";

test("parseHistory keeps commit rows and graph connector rows", () => {
  const output = [
    "* \x1eabc\x00parent\x002026-07-21\x00subject\x00HEAD -> main\x00",
    "|\\",
    "| * \x1edef\x00\x002026-07-20\x00root\x00\x00",
  ].join("\n");

  assert.deepEqual(parseHistory(output), [
    {
      kind: "commit",
      graph: "* ",
      commit: {
        hash: "abc",
        parents: ["parent"],
        date: "2026-07-21",
        subject: "subject",
        refs: "HEAD -> main",
      },
    },
    { kind: "graph", graph: "|\\" },
    {
      kind: "commit",
      graph: "| * ",
      commit: {
        hash: "def",
        parents: [],
        date: "2026-07-20",
        subject: "root",
        refs: "",
      },
    },
  ]);
});

test("parseNameStatus handles rename records and spaces", () => {
  const output = Buffer.from(
    "M\x00src/file name.ts\x00R100\x00old name.ts\x00new name.ts\x00",
  );
  assert.deepEqual(parseNameStatus(output), [
    { status: "M", path: "src/file name.ts" },
    { status: "R100", oldPath: "old name.ts", path: "new name.ts" },
  ]);
});

test("GitClient loads root and later commit changes from a temporary repository", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "hello.txt"), "root\n");
  git(repository, "add", "--", "hello.txt");
  git(repository, "commit", "-q", "-m", "root commit");
  writeFileSync(join(repository, "hello.txt"), "changed\n");
  writeFileSync(join(repository, "space name.txt"), "added\n");
  git(repository, "add", "--", "hello.txt", "space name.txt");
  git(repository, "commit", "-q", "-m", "second commit");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  client.setRepository(history.repository.root);
  const commits = history.rows
    .filter((row) => row.kind === "commit")
    .map((row) => row.commit);

  assert.equal(commits.length, 2);
  const newest = commits[0];
  const root = commits[1];
  assert.ok(newest);
  assert.ok(root);
  assert.equal(history.repository.detached, false);
  assert.equal(history.repository.root, realpathSync(repository));
  assert.deepEqual(await client.changedFiles(newest), [
    { status: "M", path: "hello.txt" },
    { status: "A", path: "space name.txt" },
  ]);
  assert.deepEqual(await client.changedFiles(root), [
    { status: "A", path: "hello.txt" },
  ]);
});

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}
