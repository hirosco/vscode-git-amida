import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";

import { FileRestoreService } from "../src/fileRestorer";

test("FileRestoreService restores exact historical bytes without staging", async (context) => {
  const repository = createRepository(context);
  const path = "images/古い image.png";
  const oldContent = Buffer.from([0x00, 0xff, 0x47, 0x69, 0x74]);
  const newContent = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  writeRepositoryFile(repository, path, oldContent);
  commitAll(repository, "old image");
  const oldRef = git(repository, "rev-parse", "HEAD").trim();
  writeRepositoryFile(repository, path, newContent);
  commitAll(repository, "new image");

  const plan = await new FileRestoreService().restore({
    repository,
    sourceRef: oldRef,
    sourcePath: path,
    destinationPath: path,
  });

  assert.equal(plan.destinationExists, true);
  assert.deepEqual(readFileSync(join(repository, path)), oldContent);
  assert.equal(git(repository, "diff", "--cached", "--name-only"), "");
  assert.equal(git(repository, "diff", "--name-only").trim(), path);
});

test("FileRestoreService recreates a file deleted from the current revision", async (context) => {
  const repository = createRepository(context);
  const path = "removed.bin";
  const oldContent = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  writeRepositoryFile(repository, path, oldContent);
  commitAll(repository, "add file");
  const oldRef = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "rm", "--", path);
  git(repository, "commit", "-q", "-m", "delete file");

  const plan = await new FileRestoreService().restore({
    repository,
    sourceRef: oldRef,
    sourcePath: path,
    destinationPath: path,
  });

  assert.equal(plan.destinationExists, false);
  assert.deepEqual(readFileSync(join(repository, path)), oldContent);
  assert.equal(git(repository, "diff", "--cached", "--name-only"), "");
  assert.match(git(repository, "status", "--short", "--", path), /^\?\?/);
});

test("FileRestoreService restores a renamed source into the current row path", async (context) => {
  const repository = createRepository(context);
  writeRepositoryFile(repository, "old-name.png", "old bytes\n");
  commitAll(repository, "old path");
  const oldRef = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "mv", "--", "old-name.png", "new-name.png");
  writeRepositoryFile(repository, "new-name.png", "new bytes\n");
  commitAll(repository, "rename and edit");

  await new FileRestoreService().restore({
    repository,
    sourceRef: oldRef,
    sourcePath: "old-name.png",
    destinationPath: "new-name.png",
  });

  assert.equal(
    readFileSync(join(repository, "new-name.png"), "utf8"),
    "old bytes\n",
  );
  assert.equal(git(repository, "diff", "--cached", "--name-only"), "");
});

test("FileRestoreService refuses staged and unstaged target changes", async (context) => {
  const repository = createRepository(context);
  const path = "tracked.txt";
  writeRepositoryFile(repository, path, "old\n");
  commitAll(repository, "old");
  const oldRef = git(repository, "rev-parse", "HEAD").trim();
  writeRepositoryFile(repository, path, "current\n");
  commitAll(repository, "current");
  const service = new FileRestoreService();

  writeRepositoryFile(repository, path, "unstaged\n");
  await assert.rejects(
    service.restore({
      repository,
      sourceRef: oldRef,
      sourcePath: path,
      destinationPath: path,
    }),
    /unstaged changes/,
  );
  assert.equal(readFileSync(join(repository, path), "utf8"), "unstaged\n");

  git(repository, "add", "--", path);
  await assert.rejects(
    service.restore({
      repository,
      sourceRef: oldRef,
      sourcePath: path,
      destinationPath: path,
    }),
    /staged changes/,
  );
  assert.equal(readFileSync(join(repository, path), "utf8"), "unstaged\n");
});

test("FileRestoreService refuses an existing untracked or ignored target", async (context) => {
  const repository = createRepository(context);
  const path = "ignored.bin";
  writeRepositoryFile(repository, path, "historical\n");
  commitAll(repository, "historical file");
  const oldRef = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "rm", "--", path);
  writeRepositoryFile(repository, ".gitignore", `${path}\n`);
  commitAll(repository, "delete and ignore file");
  writeRepositoryFile(repository, path, "local ignored content\n");

  await assert.rejects(
    new FileRestoreService().restore({
      repository,
      sourceRef: oldRef,
      sourcePath: path,
      destinationPath: path,
    }),
    /untracked or ignored/,
  );
  assert.equal(
    readFileSync(join(repository, path), "utf8"),
    "local ignored content\n",
  );
});

test("FileRestoreService rejects paths outside the repository and symbolic links", async (context) => {
  const repository = createRepository(context);
  writeRepositoryFile(repository, "source.txt", "source\n");
  symlinkSync("source.txt", join(repository, "historical-link"));
  commitAll(repository, "source and link");
  const sourceRef = git(repository, "rev-parse", "HEAD").trim();
  symlinkSync("source.txt", join(repository, "working-link"));
  mkdirSync(join(repository, "real-directory"));
  symlinkSync("real-directory", join(repository, "linked-directory"));
  const service = new FileRestoreService();

  await assert.rejects(
    service.preflight({
      repository,
      sourceRef,
      sourcePath: "source.txt",
      destinationPath: "../outside.txt",
    }),
    /outside the repository/,
  );
  await assert.rejects(
    service.preflight({
      repository,
      sourceRef,
      sourcePath: "historical-link",
      destinationPath: "restored.txt",
    }),
    /symbolic-link revision/,
  );
  await assert.rejects(
    service.preflight({
      repository,
      sourceRef,
      sourcePath: "source.txt",
      destinationPath: "working-link",
    }),
    /symbolic link/,
  );
  await assert.rejects(
    service.preflight({
      repository,
      sourceRef,
      sourcePath: "source.txt",
      destinationPath: "linked-directory/restored.txt",
    }),
    /symbolic link/,
  );
});

test("FileRestoreService rejects a destination inside a submodule entry", async (context) => {
  const repository = createRepository(context);
  writeRepositoryFile(repository, "source.txt", "source\n");
  commitAll(repository, "source");
  const sourceRef = git(repository, "rev-parse", "HEAD").trim();
  git(
    repository,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${sourceRef},vendor`,
  );
  git(repository, "commit", "-q", "-m", "add gitlink");

  await assert.rejects(
    new FileRestoreService().preflight({
      repository,
      sourceRef,
      sourcePath: "source.txt",
      destinationPath: "vendor/restored.txt",
    }),
    /inside a submodule/,
  );
});

function createRepository(context: TestContext): string {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-restore-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");
  return repository;
}

function writeRepositoryFile(
  repository: string,
  path: string,
  content: string | Buffer,
): void {
  mkdirSync(dirname(join(repository, path)), { recursive: true });
  writeFileSync(join(repository, path), content);
}

function commitAll(repository: string, message: string): void {
  git(repository, "add", "--all", "--");
  git(repository, "commit", "-q", "-m", message);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
