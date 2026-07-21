import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  GitClient,
  MAX_TEXT_BLOB_BYTES,
  parseBinaryPaths,
  parseHistory,
  parseRawDiff,
  parseRefs,
} from "../src/git";
import { resolveRange } from "../src/selection";
import { buildSelectionFiles } from "../src/selectionFiles";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

test("parseHistory reads commit records without terminal graph text", () => {
  const output = [
    "\x1b[31m* \x1b[m\x1eabc\x00abc1234\x00parent\x00A. U. Thor\x00author@example.invalid\x002026-07-21T10:00:00+09:00\x002026-07-21T11:00:00+09:00\x00subject\x00",
    "\x1b[31m|\\\x1b[m",
    "\x1b[33m| * \x1b[m\x1edef\x00def5678\x00\x00Root Author\x00root@example.invalid\x002026-07-20T10:00:00+09:00\x002026-07-20T10:00:00+09:00\x00root\x00",
  ].join("\n");
  const refs = parseRefs(
    [
      "\x1eabc\x00\x00refs/heads/main\x00*\x00origin/main\x00>\x00",
      "\x1eabc\x00\x00refs/remotes/origin/main\x00 \x00\x00\x00",
      "\x1etag-object\x00abc\x00refs/tags/v1\x00 \x00\x00\x00",
    ].join("\n"),
  );

  assert.deepEqual(parseHistory(output, refs), [
    {
      hash: "abc",
      shortHash: "abc1234",
      parents: ["parent"],
      authorName: "A. U. Thor",
      authorEmail: "author@example.invalid",
      authoredAt: "2026-07-21T10:00:00+09:00",
      committedAt: "2026-07-21T11:00:00+09:00",
      subject: "subject",
      refs: [
        {
          name: "main",
          fullName: "refs/heads/main",
          type: "localBranch",
          current: true,
          upstream: "origin/main",
          tracking: ">",
        },
        {
          name: "origin/main",
          fullName: "refs/remotes/origin/main",
          type: "remoteBranch",
          current: false,
        },
        {
          name: "v1",
          fullName: "refs/tags/v1",
          type: "tag",
          current: false,
        },
      ],
    },
    {
      hash: "def",
      shortHash: "def5678",
      parents: [],
      authorName: "Root Author",
      authorEmail: "root@example.invalid",
      authoredAt: "2026-07-20T10:00:00+09:00",
      committedAt: "2026-07-20T10:00:00+09:00",
      subject: "root",
      refs: [],
    },
  ]);
});

test("parseRawDiff and parseBinaryPaths preserve rename metadata", () => {
  assert.deepEqual(
    parseRawDiff(
      Buffer.from(
        ":100644 100644 abc def M\x00src/file name.ts\x00" +
          ":100644 100644 123 456 R100\x00old.bin\x00new.bin\x00",
      ),
    ),
    [
      {
        status: "M",
        path: "src/file name.ts",
        oldMode: "100644",
        newMode: "100644",
        oldObject: "abc",
        newObject: "def",
      },
      {
        status: "R100",
        oldPath: "old.bin",
        path: "new.bin",
        oldMode: "100644",
        newMode: "100644",
        oldObject: "123",
        newObject: "456",
      },
    ],
  );
  assert.deepEqual(
    parseBinaryPaths(
      Buffer.from(
        "1\t2\ttext.txt\x00" +
          "-\t-\tbinary\tname.bin\x00" +
          "-\t-\t\x00old.bin\x00new.bin\x00",
      ),
    ),
    new Set(["binary\tname.bin", "new.bin"]),
  );
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
  git(repository, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(repository, "tag", "v1", "HEAD~1");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const commits = history.rows.map((row) => row.commit);

  assert.equal(commits.length, 2);
  const newest = commits[0];
  const root = commits[1];
  assert.ok(newest);
  assert.ok(root);
  assert.equal(history.repository.detached, false);
  assert.equal(history.repository.root, realpathSync(repository));
  assert.equal(history.repository.head, newest.hash);
  assert.ok(newest.shortHash.length >= 4);
  assert.equal(newest.authorName, "GitAmida Test");
  assert.equal(newest.authorEmail, "test@example.invalid");
  assert.deepEqual(
    newest.refs.map((ref) => [ref.type, ref.name, ref.current]),
    [
      ["localBranch", history.repository.branch, true],
      ["remoteBranch", "origin/main", false],
    ],
  );
  assert.deepEqual(root.refs.map((ref) => ref.name), ["v1"]);
  assert.deepEqual(await client.changedFiles(history.repository.root, newest), [
    { status: "M", path: "hello.txt" },
    { status: "A", path: "space name.txt" },
  ]);
  assert.deepEqual(await client.changedFiles(history.repository.root, root), [
    { status: "A", path: "hello.txt" },
  ]);
});

test("GitClient loads all branch, remote, and tag history in one evaluation pass", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-history-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  let parent: string | undefined;
  for (let index = 0; index < 105; index += 1) {
    parent = git(
      repository,
      "commit-tree",
      EMPTY_TREE,
      ...(parent === undefined ? [] : ["-p", parent]),
      "-m",
      `commit ${index}`,
    ).trim();
  }
  assert.ok(parent);
  git(repository, "update-ref", "refs/heads/main", parent);

  const side = git(repository, "commit-tree", EMPTY_TREE, "-m", "side").trim();
  const remote = git(repository, "commit-tree", EMPTY_TREE, "-m", "remote").trim();
  const tagged = git(repository, "commit-tree", EMPTY_TREE, "-m", "tagged").trim();
  const stashed = git(repository, "commit-tree", EMPTY_TREE, "-m", "stashed").trim();
  git(repository, "update-ref", "refs/heads/side", side);
  git(repository, "update-ref", "refs/remotes/origin/archive", remote);
  git(repository, "update-ref", "refs/tags/archive", tagged);
  git(repository, "update-ref", "refs/stash", stashed);

  const history = await new GitClient().loadHistory(repository);
  const commits = history.rows;
  assert.equal(commits.length, 108);
  const hashes = new Set(commits.map((row) => row.commit.hash));
  assert.equal(hashes.has(parent), true);
  assert.equal(hashes.has(side), true);
  assert.equal(hashes.has(remote), true);
  assert.equal(hashes.has(tagged), true);
  assert.equal(hashes.has(stashed), false);
});

test("GitClient compares the final effect of a linear commit range", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-range-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "shared.txt"), "root\n");
  writeFileSync(join(repository, "stable.txt"), "stable\n");
  git(repository, "add", "--", "shared.txt", "stable.txt");
  git(repository, "commit", "-q", "-m", "root");
  writeFileSync(join(repository, "shared.txt"), "second\n");
  writeFileSync(join(repository, "transient.txt"), "temporary\n");
  git(repository, "add", "--", "shared.txt", "transient.txt");
  git(repository, "commit", "-q", "-m", "second");
  writeFileSync(join(repository, "shared.txt"), "third\n");
  rmSync(join(repository, "transient.txt"));
  writeFileSync(join(repository, "final.txt"), "final\n");
  git(repository, "add", "--", "shared.txt", "transient.txt", "final.txt");
  git(repository, "commit", "-q", "-m", "third");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const bySubject = new Map(
    history.rows.map((row) => [row.commit.subject, row.commit]),
  );
  const root = bySubject.get("root");
  const third = bySubject.get("third");
  assert.ok(root);
  assert.ok(third);

  assert.deepEqual(
    await client.changedFilesBetween(repository, root.hash, third.hash),
    [
      { status: "A", path: "final.txt" },
      { status: "M", path: "shared.txt" },
    ],
  );
  assert.equal(
    (await client.readBlob(repository, root.hash, "shared.txt")).toString(),
    "root\n",
  );
  assert.equal(
    (await client.readBlob(repository, third.hash, "shared.txt")).toString(),
    "third\n",
  );
});

test("GitClient preserves additions, deletions, and renames in a Range", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-range-files-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "delete.txt"), "delete me\n");
  writeFileSync(join(repository, "old.txt"), "rename me\n");
  git(repository, "add", "--", "delete.txt", "old.txt");
  git(repository, "commit", "-q", "-m", "root");
  const root = git(repository, "rev-parse", "HEAD").trim();

  rmSync(join(repository, "delete.txt"));
  renameSync(join(repository, "old.txt"), join(repository, "new.txt"));
  writeFileSync(join(repository, "added.txt"), "added\n");
  git(repository, "add", "--all");
  git(repository, "commit", "-q", "-m", "change files");
  const tip = git(repository, "rev-parse", "HEAD").trim();

  const client = new GitClient();
  assert.deepEqual(await client.changedFilesBetween(repository, root, tip), [
    { status: "A", path: "added.txt" },
    { status: "D", path: "delete.txt" },
    { status: "R100", path: "new.txt", oldPath: "old.txt" },
  ]);
  assert.equal(
    (await client.readBlob(repository, root, "old.txt")).toString(),
    "rename me\n",
  );
  assert.equal(
    (await client.readBlob(repository, tip, "new.txt")).toString(),
    "rename me\n",
  );
});

test("GitClient classifies unsupported changed content before opening a diff", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-content-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "root.txt"), "root\n");
  git(repository, "add", "--", "root.txt");
  git(repository, "commit", "-q", "-m", "root");
  const root = git(repository, "rev-parse", "HEAD").trim();

  writeFileSync(join(repository, "archive.bin"), Buffer.from([1, 0, 2]));
  writeFileSync(
    join(repository, "photo.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]),
  );
  writeFileSync(
    join(repository, "large.txt"),
    Buffer.alloc(MAX_TEXT_BLOB_BYTES + 1, "a"),
  );
  git(repository, "add", "--", "archive.bin", "photo.png", "large.txt");
  git(
    repository,
    "update-index",
    "--add",
    "--cacheinfo",
    "160000",
    root,
    "vendor/module",
  );
  git(repository, "commit", "-q", "-m", "unsupported content");
  const tip = git(repository, "rev-parse", "HEAD").trim();

  const files = await new GitClient().changedFilesBetween(
    repository,
    root,
    tip,
  );
  const byPath = new Map(files.map((file) => [file.path, file]));
  assert.deepEqual(byPath.get("archive.bin"), {
    status: "A",
    path: "archive.bin",
    content: { kind: "binary", size: 3 },
  });
  assert.deepEqual(byPath.get("photo.png"), {
    status: "A",
    path: "photo.png",
    content: { kind: "image", size: 6 },
  });
  assert.deepEqual(byPath.get("large.txt"), {
    status: "A",
    path: "large.txt",
    content: { kind: "oversized", size: MAX_TEXT_BLOB_BYTES + 1 },
  });
  assert.deepEqual(byPath.get("vendor/module"), {
    status: "A",
    path: "vendor/module",
    content: { kind: "submodule" },
  });
});

test("GitClient compares a merge range from its declared base to tip", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-merge-range-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  writeFileSync(join(repository, "root.txt"), "root\n");
  git(repository, "add", "--", "root.txt");
  git(repository, "commit", "-q", "-m", "root");
  const root = git(repository, "rev-parse", "HEAD").trim();

  git(repository, "switch", "-q", "-c", "side");
  writeFileSync(join(repository, "side.txt"), "side\n");
  git(repository, "add", "--", "side.txt");
  git(repository, "commit", "-q", "-m", "side");

  git(repository, "switch", "-q", "main");
  writeFileSync(join(repository, "main.txt"), "main\n");
  git(repository, "add", "--", "main.txt");
  git(repository, "commit", "-q", "-m", "main");
  const main = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "merge", "-q", "--no-ff", "side", "-m", "merge");
  const merge = git(repository, "rev-parse", "HEAD").trim();

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const commits = new Map(
    history.rows.map((row) => [row.commit.hash, row.commit]),
  );
  const result = resolveRange(commits, main, merge);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const side = history.rows.find(
    (row) => row.commit.subject === "side",
  )?.commit;
  assert.ok(side);
  assert.equal(result.selection.baseHash, root);
  assert.deepEqual(
    new Set(result.selection.commitHashes),
    new Set([main, side.hash, merge]),
  );
  assert.deepEqual(
    await client.changedFilesBetween(
      repository,
      result.selection.baseHash,
      result.selection.newestHash,
    ),
    [
      { status: "A", path: "main.txt" },
      { status: "A", path: "side.txt" },
    ],
  );
});

test("explicit Selection keeps unrelated branch changes separate", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-selection-branch-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  writeFileSync(join(repository, "shared.txt"), "base\n");
  git(repository, "add", "--", "shared.txt");
  git(repository, "commit", "-q", "-m", "root");

  git(repository, "switch", "-q", "-c", "side");
  writeFileSync(join(repository, "shared.txt"), "side\n");
  writeFileSync(join(repository, "side-only.txt"), "side\n");
  git(repository, "add", "--", "shared.txt", "side-only.txt");
  git(repository, "commit", "-q", "-m", "side change");

  git(repository, "switch", "-q", "main");
  writeFileSync(join(repository, "shared.txt"), "main\n");
  writeFileSync(join(repository, "main-only.txt"), "main\n");
  git(repository, "add", "--", "shared.txt", "main-only.txt");
  git(repository, "commit", "-q", "-m", "main change");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const bySubject = new Map(
    history.rows.map((row) => [row.commit.subject, row.commit]),
  );
  const main = bySubject.get("main change");
  const side = bySubject.get("side change");
  assert.ok(main);
  assert.ok(side);

  const states = buildSelectionFiles(
    [
      ...(await client.commitFileChanges(repository, main)),
      ...(await client.commitFileChanges(repository, side)),
    ],
    [main.hash, side.hash],
  );
  assert.deepEqual(
    states.map((state) => state.file.path),
    ["main-only.txt", "shared.txt", "side-only.txt"],
  );
  const shared = states.find((state) => state.file.path === "shared.txt");
  assert.ok(shared);
  assert.equal(shared.combined, undefined);
  assert.deepEqual(
    shared.file.selection?.changes.map((change) => change.commitHash),
    [main.hash, side.hash],
  );
});

test("explicit Selection does not bridge an omitted file revision", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-selection-gap-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "shared.txt"), "root\n");
  git(repository, "add", "--", "shared.txt");
  git(repository, "commit", "-q", "-m", "root");
  writeFileSync(join(repository, "shared.txt"), "selected old\n");
  git(repository, "commit", "-q", "-am", "selected old");
  const selectedOld = git(repository, "rev-parse", "HEAD").trim();
  writeFileSync(join(repository, "shared.txt"), "omitted\n");
  git(repository, "commit", "-q", "-am", "omitted");
  writeFileSync(join(repository, "shared.txt"), "selected new\n");
  git(repository, "commit", "-q", "-am", "selected new");
  const selectedNew = git(repository, "rev-parse", "HEAD").trim();

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const commits = new Map(
    history.rows.map((row) => [row.commit.hash, row.commit]),
  );
  const oldCommit = commits.get(selectedOld);
  const newCommit = commits.get(selectedNew);
  assert.ok(oldCommit);
  assert.ok(newCommit);

  const states = buildSelectionFiles(
    [
      ...(await client.commitFileChanges(repository, newCommit)),
      ...(await client.commitFileChanges(repository, oldCommit)),
    ],
    [selectedNew, selectedOld],
  );
  assert.equal(states.length, 1);
  assert.equal(states[0]?.file.path, "shared.txt");
  assert.equal(states[0]?.combined, undefined);
  assert.equal(states[0]?.file.selection?.combined, false);
});

test("GitClient builds connected lanes for a merge history", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-merge-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  const root = git(repository, "commit-tree", EMPTY_TREE, "-m", "root").trim();
  const main = git(
    repository,
    "commit-tree",
    EMPTY_TREE,
    "-p",
    root,
    "-m",
    "main",
  ).trim();
  const side = git(
    repository,
    "commit-tree",
    EMPTY_TREE,
    "-p",
    root,
    "-m",
    "side",
  ).trim();
  const merge = git(
    repository,
    "commit-tree",
    EMPTY_TREE,
    "-p",
    main,
    "-p",
    side,
    "-m",
    "merge",
  ).trim();
  git(repository, "update-ref", "refs/heads/main", merge);
  git(repository, "update-ref", "refs/heads/side", side);

  const history = await new GitClient().loadHistory(repository);
  assert.equal(history.rows[0]?.commit.hash, merge);
  assert.equal(history.graphLaneCount, 2);
  assert.deepEqual(history.rows[0]?.commit.parents, [main, side]);
  assert.equal(
    history.rows.some((row) =>
      row.graph.lines.some((line) => line.fromLane !== line.toLane),
    ),
    true,
  );
});

test("GitClient orders independent lanes by commit date", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-order-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  const root = commitTree(repository, "root", "2026-07-21T00:00:00Z");
  const mainEarly = commitTree(
    repository,
    "main early",
    "2026-07-21T01:00:00Z",
    root,
  );
  const mainTip = commitTree(
    repository,
    "main tip",
    "2026-07-21T05:00:00Z",
    mainEarly,
  );
  const sideMiddle = commitTree(
    repository,
    "side middle",
    "2026-07-21T03:00:00Z",
    root,
  );
  const sideTip = commitTree(
    repository,
    "side tip",
    "2026-07-21T04:00:00Z",
    sideMiddle,
  );
  git(repository, "update-ref", "refs/heads/main", mainTip);
  git(repository, "update-ref", "refs/heads/side", sideTip);

  const history = await new GitClient().loadHistory(repository);
  assert.deepEqual(
    history.rows.map((row) => row.commit.subject),
    ["main tip", "side tip", "side middle", "main early", "root"],
  );
});

function commitTree(
  repository: string,
  message: string,
  timestamp: string,
  parent?: string,
): string {
  return execFileSync(
    "git",
    [
      "-C",
      repository,
      "commit-tree",
      EMPTY_TREE,
      ...(parent === undefined ? [] : ["-p", parent]),
      "-m",
      message,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: timestamp,
        GIT_COMMITTER_DATE: timestamp,
      },
    },
  ).trim();
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}
