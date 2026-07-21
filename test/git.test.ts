import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GitClient, parseHistory, parseNameStatus, parseRefs } from "../src/git";
import { resolveRange } from "../src/selection";

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
