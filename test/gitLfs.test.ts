import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import {
  GitClient,
  GitLfsObjectMissingError,
} from "../src/git";
import {
  gitLfsFetchArgs,
  parseGitLfsPointer,
} from "../src/gitLfs";

test("parseGitLfsPointer accepts canonical LF and CRLF pointers", () => {
  const oid = "a".repeat(64);
  const lf = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize 42\n`,
  );
  const crlf = Buffer.from(
    `version https://git-lfs.github.com/spec/v1\r\noid sha256:${oid}\r\nsize 42\r\n`,
  );

  assert.deepEqual(parseGitLfsPointer(lf), { oid, size: 42 });
  assert.deepEqual(parseGitLfsPointer(crlf), { oid, size: 42 });
  assert.equal(parseGitLfsPointer(Buffer.from("ordinary text\n")), undefined);
});

test("parseGitLfsPointer rejects malformed and extension pointers", () => {
  const oid = "a".repeat(64);

  assert.throws(
    () => parseGitLfsPointer(Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\next-1-demo sha256:${oid}\nsize 42\n`,
    )),
    /extensions are not supported/,
  );
  assert.throws(
    () => parseGitLfsPointer(Buffer.from(
      `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize invalid\n`,
    )),
    /pointer is malformed/,
  );
});

test("gitLfsFetchArgs limits downloads to one safe path and revision", () => {
  const ref = "a".repeat(40);

  assert.deepEqual(gitLfsFetchArgs("origin", ref, "media/image.png"), [
    "-c",
    "lfs.fetchrecentalways=false",
    "-c",
    "lfs.remote.autodetect=false",
    "-c",
    "lfs.remote.searchall=false",
    "lfs",
    "fetch",
    "--include=media/image.png",
    "--exclude=",
    "origin",
    ref,
  ]);
  for (const path of [
    "../image.png",
    "media/*.png",
    "media/image,name.png",
    "#image.png",
    " media/image.png",
  ]) {
    assert.throws(
      () => gitLfsFetchArgs("origin", ref, path),
      /cannot be limited to one safe Git LFS fetch/,
    );
  }
  assert.throws(
    () => gitLfsFetchArgs("-origin", ref, "image.png"),
    /remote name is not safe/,
  );
  assert.throws(
    () => gitLfsFetchArgs("origin", "HEAD", "image.png"),
    /revision is not a commit hash/,
  );
});

test("GitClient resolves and verifies a historical object from the local LFS cache", async (context) => {
  const content = Buffer.from([0x00, 0x47, 0x69, 0x74, 0xff]);
  const fixture = createPointerRepository(context, content);
  writeLfsObject(fixture.repository, fixture.oid, content);
  const client = new GitClient();

  const info = await client.inspectHistoricalBlob(
    fixture.repository,
    fixture.ref,
    fixture.path,
  );

  assert.equal(info.size, content.byteLength);
  assert.deepEqual(info.lfs, {
    oid: fixture.oid,
    size: content.byteLength,
    available: true,
  });
  if (info.lfs === undefined) {
    assert.fail("Expected a Git LFS pointer.");
  }
  await client.fetchHistoricalGitLfsBlob(
    fixture.repository,
    fixture.ref,
    fixture.path,
    info.lfs,
  );
  assert.deepEqual(
    await client.readHistoricalBlob(
      fixture.repository,
      fixture.ref,
      fixture.path,
      info,
    ),
    content,
  );
});

test("GitClient reports a missing historical LFS object without downloading", async (context) => {
  const fixture = createPointerRepository(context, Buffer.from("missing\n"));
  const client = new GitClient();
  const info = await client.inspectHistoricalBlob(
    fixture.repository,
    fixture.ref,
    fixture.path,
  );

  assert.equal(info.lfs?.available, false);
  await assert.rejects(
    client.readHistoricalBlob(
      fixture.repository,
      fixture.ref,
      fixture.path,
      info,
    ),
    GitLfsObjectMissingError,
  );
});

test("GitClient honors a repository-relative custom LFS storage directory", async (context) => {
  const content = Buffer.from("custom storage\n");
  const fixture = createPointerRepository(context, content);
  git(fixture.repository, "config", "lfs.storage", "custom-lfs");
  writeLfsObject(fixture.repository, fixture.oid, content, "custom-lfs");
  const client = new GitClient();
  const info = await client.inspectHistoricalBlob(
    fixture.repository,
    fixture.ref,
    fixture.path,
  );

  assert.equal(info.lfs?.available, true);
  assert.deepEqual(
    await client.readHistoricalBlob(
      fixture.repository,
      fixture.ref,
      fixture.path,
      info,
    ),
    content,
  );
});

test("GitClient rejects a corrupt historical LFS object", async (context) => {
  const content = Buffer.from("valid\n");
  const fixture = createPointerRepository(context, content);
  writeLfsObject(fixture.repository, fixture.oid, Buffer.from("fault\n"));
  const client = new GitClient();
  const info = await client.inspectHistoricalBlob(
    fixture.repository,
    fixture.ref,
    fixture.path,
  );

  await assert.rejects(
    client.readHistoricalBlob(
      fixture.repository,
      fixture.ref,
      fixture.path,
      info,
    ),
    /failed integrity verification/,
  );
});

test("GitClient refuses custom LFS transfer commands before downloading", async (context) => {
  const fixture = createPointerRepository(context, Buffer.from("missing\n"));
  git(fixture.repository, "remote", "add", "origin", "https://example.invalid/repository.git");
  git(
    fixture.repository,
    "config",
    "lfs.customtransfer.unsafe.path",
    "unexpected-transfer-command",
  );

  await assert.rejects(
    new GitClient().fetchHistoricalGitLfsBlob(
      fixture.repository,
      fixture.ref,
      fixture.path,
      { oid: fixture.oid, size: 8 },
    ),
    /does not execute custom Git LFS transfer commands/,
  );
});

test(
  "GitClient downloads one historical object without changing the working tree or index",
  { skip: !gitLfsAvailable() },
  async (context) => {
    const root = mkdtempSync(join(tmpdir(), "git-amida-lfs-fetch-test-"));
    context.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, "source");
    const remote = join(root, "remote.git");
    const repository = join(root, "clone");
    mkdirSync(source);
    git(source, "init", "-q");
    git(source, "config", "user.name", "GitAmida Test");
    git(source, "config", "user.email", "git-amida@example.invalid");
    git(source, "lfs", "install", "--local");
    writeFileSync(
      join(source, ".gitattributes"),
      "assets/*.bin filter=lfs diff=lfs merge=lfs -text\n",
    );
    mkdirSync(join(source, "assets"));
    const content = Buffer.from([0x00, 0x47, 0x69, 0x74, 0xff]);
    writeFileSync(join(source, "assets", "asset.bin"), content);
    git(source, "add", "--", ".gitattributes", "assets/asset.bin");
    git(source, "commit", "-q", "-m", "add lfs object");
    git(source, "branch", "-M", "main");
    git(root, "init", "-q", "--bare", remote);
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "-q", "-u", "origin", "main");
    git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    git(root, "clone", "-q", "--no-checkout", remote, repository);

    const ref = git(repository, "rev-parse", "HEAD").trim();
    const path = "assets/asset.bin";
    const client = new GitClient();
    const before = await client.inspectHistoricalBlob(repository, ref, path);
    assert.equal(before.lfs?.available, false);
    const statusBefore = git(repository, "status", "--porcelain=v1");
    const indexBefore = git(repository, "diff", "--cached", "--binary");

    if (before.lfs === undefined) {
      assert.fail("Expected a Git LFS pointer.");
    }
    await client.fetchHistoricalGitLfsBlob(
      repository,
      ref,
      path,
      before.lfs,
    );
    const after = await client.inspectHistoricalBlob(repository, ref, path);

    assert.equal(after.lfs?.available, true);
    assert.deepEqual(
      await client.readHistoricalBlob(repository, ref, path, after),
      content,
    );
    assert.equal(git(repository, "status", "--porcelain=v1"), statusBefore);
    assert.equal(git(repository, "diff", "--cached", "--binary"), indexBefore);
  },
);

function createPointerRepository(
  context: TestContext,
  content: Buffer,
): { repository: string; ref: string; path: string; oid: string } {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-lfs-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "git-amida@example.invalid");
  const oid = createHash("sha256").update(content).digest("hex");
  const path = "media/asset.bin";
  mkdirSync(join(repository, "media"));
  writeFileSync(
    join(repository, path),
    `version https://git-lfs.github.com/spec/v1\n` +
      `oid sha256:${oid}\n` +
      `size ${content.byteLength}\n`,
  );
  git(repository, "add", "--", path);
  git(repository, "commit", "-q", "-m", "add lfs pointer");
  return {
    repository,
    ref: git(repository, "rev-parse", "HEAD").trim(),
    path,
    oid,
  };
}

function writeLfsObject(
  repository: string,
  oid: string,
  content: Buffer,
  storage = "lfs",
): void {
  const directory = join(
    repository,
    ".git",
    storage,
    "objects",
    oid.slice(0, 2),
    oid.slice(2, 4),
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, oid), content);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  });
}

function gitLfsAvailable(): boolean {
  try {
    execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
