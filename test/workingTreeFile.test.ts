import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { resolveWorkingTreeFile } from "../src/workingTreeFile";

test("resolveWorkingTreeFile accepts a regular repository file", async (context) => {
  const repository = createDirectory(context, "git-amida-open-file-");
  mkdirSync(join(repository, "nested"));
  writeFileSync(join(repository, "nested", "file.txt"), "content\n");

  assert.equal(
    await resolveWorkingTreeFile(repository, "nested/file.txt"),
    resolve(repository, "nested/file.txt"),
  );
});

test("resolveWorkingTreeFile rejects missing and non-file paths", async (context) => {
  const repository = createDirectory(context, "git-amida-open-file-");
  mkdirSync(join(repository, "directory"));

  await assert.rejects(
    resolveWorkingTreeFile(repository, "missing.txt"),
    /does not exist/,
  );
  await assert.rejects(
    resolveWorkingTreeFile(repository, "directory"),
    /not a regular file/,
  );
});

test("resolveWorkingTreeFile rejects paths outside the repository and symbolic links", async (context) => {
  const root = createDirectory(context, "git-amida-open-file-");
  const repository = join(root, "repository");
  const outside = join(root, "outside");
  mkdirSync(repository);
  mkdirSync(outside);
  writeFileSync(join(repository, "file.txt"), "content\n");
  writeFileSync(join(outside, "outside.txt"), "outside\n");
  symlinkSync("file.txt", join(repository, "file-link"));
  symlinkSync(outside, join(repository, "outside-link"));

  await assert.rejects(
    resolveWorkingTreeFile(repository, "../outside/outside.txt"),
    /outside the repository/,
  );
  await assert.rejects(
    resolveWorkingTreeFile(repository, "file-link"),
    /not a regular file/,
  );
  await assert.rejects(
    resolveWorkingTreeFile(repository, "outside-link/outside.txt"),
    /resolves outside the repository/,
  );
});

function createDirectory(context: TestContext, prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
