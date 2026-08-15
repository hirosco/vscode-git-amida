import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  EmptyRepositoryError,
  GitClient,
  GitCancellationError,
  HistoryChangedError,
  NotGitRepositoryError,
  parseBinaryPaths,
  parseFileHistory,
  parseHistory,
  parseNulPaths,
  parseRawDiff,
  parseRefs,
} from "../src/git";
import { buildHistoryGraph } from "../src/graph";
import type { HistoryRow } from "../src/model";
import {
  resolveRange,
  resolveVisibleSelection,
} from "../src/selection";
import { buildSelectionFiles } from "../src/selectionFiles";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

test("GitClient distinguishes empty and non-Git folders", async (context) => {
  const emptyRepository = mkdtempSync(join(tmpdir(), "git-amida-empty-test-"));
  const plainFolder = mkdtempSync(join(tmpdir(), "git-amida-plain-test-"));
  context.after(() => {
    rmSync(emptyRepository, { recursive: true, force: true });
    rmSync(plainFolder, { recursive: true, force: true });
  });
  git(emptyRepository, "init", "-q");

  const client = new GitClient();
  await assert.rejects(
    client.loadHistory(emptyRepository),
    EmptyRepositoryError,
  );
  await assert.rejects(
    client.resolveRepository(plainFolder),
    NotGitRepositoryError,
  );
});

test("GitClient reports an aborted Git request as cancellation", async () => {
  const diagnostics: string[] = [];
  const client = new GitClient((event) => {
    diagnostics.push(`${event.operation}:${event.status}`);
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    client.resolveRepository(process.cwd(), controller.signal),
    GitCancellationError,
  );
  assert.deepEqual(diagnostics, ["Repository discovery:cancelled"]);
});

test("parseHistory reads commit records without terminal graph text", () => {
  const output = [
    "\x1b[31m* \x1b[m\x1eabc\x00abc1234\x00parent\x00A. U. Thor\x00author@example.invalid\x002026-07-21T10:00:00+09:00\x002026-07-21T11:00:00+09:00\x00subject\x00First paragraph.\n\nSecond paragraph.\n\x00",
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
      body: "First paragraph.\n\nSecond paragraph.",
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

test("parseRefs retains a remote default symbolic target", () => {
  const refs = parseRefs(
    [
      "\x1eabc\x00\x00refs/remotes/origin/HEAD\x00 \x00\x00\x00refs/remotes/origin/main\x00",
      "\x1eabc\x00\x00refs/remotes/origin/main\x00 \x00\x00\x00\x00",
    ].join("\n"),
  ).get("abc");

  assert.equal(
    refs?.find((ref) => ref.name === "origin/HEAD")?.symbolicTarget,
    "refs/remotes/origin/main",
  );
  assert.equal(
    refs?.find((ref) => ref.name === "origin/main")?.symbolicTarget,
    undefined,
  );
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

test("parseFileHistory preserves revision paths and rename metadata", () => {
  const output = Buffer.from(
    "\x1enew\x00new1234\x00old\x00Author\x00author@example.invalid\x00" +
      "2026-08-02T10:00:00+09:00\x002026-08-02T11:00:00+09:00\x00rename\x00Explain the rename.\n\nKeep both paths visible.\n\x00\x00\n" +
      ":100644 100644 1111111 2222222 R100\x00old name.png\x00new name.png\x00" +
      "\x1eold\x00old1234\x00\x00Author\x00author@example.invalid\x00" +
      "2026-08-01T10:00:00+09:00\x002026-08-01T10:00:00+09:00\x00add\x00\x00\n" +
      ":000000 100644 0000000 1111111 A\x00old name.png\x00",
  );

  assert.deepEqual(parseFileHistory(output), [
    {
      commit: {
        hash: "new",
        shortHash: "new1234",
        parents: ["old"],
        authorName: "Author",
        authorEmail: "author@example.invalid",
        authoredAt: "2026-08-02T10:00:00+09:00",
        committedAt: "2026-08-02T11:00:00+09:00",
        subject: "rename",
        body: "Explain the rename.\n\nKeep both paths visible.",
        refs: [],
      },
      status: "R100",
      oldPath: "old name.png",
      path: "new name.png",
    },
    {
      commit: {
        hash: "old",
        shortHash: "old1234",
        parents: [],
        authorName: "Author",
        authorEmail: "author@example.invalid",
        authoredAt: "2026-08-01T10:00:00+09:00",
        committedAt: "2026-08-01T10:00:00+09:00",
        subject: "add",
        refs: [],
      },
      status: "A",
      path: "old name.png",
    },
  ]);
});

test("GitClient follows renamed file history", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-file-history-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "old name.txt"), "one\n");
  git(repository, "add", "--", "old name.txt");
  git(repository, "commit", "-q", "-m", "add file");
  renameSync(
    join(repository, "old name.txt"),
    join(repository, "new name.txt"),
  );
  git(repository, "add", "-A", "--", "old name.txt", "new name.txt");
  git(repository, "commit", "-q", "-m", "rename file");
  writeFileSync(join(repository, "new name.txt"), "two\n");
  git(repository, "add", "--", "new name.txt");
  git(
    repository,
    "commit",
    "-q",
    "-m",
    "modify file",
    "-m",
    "Explain the file-history change.\n\nKeep this paragraph visible.",
  );
  unlinkSync(join(repository, "new name.txt"));
  git(repository, "add", "-A", "--", "new name.txt");
  git(repository, "commit", "-q", "-m", "delete file");

  const revisions = await new GitClient().fileHistory(
    repository,
    "new name.txt",
  );
  assert.equal(
    revisions.find((revision) => revision.commit.subject === "modify file")
      ?.commit.body,
    "Explain the file-history change.\n\nKeep this paragraph visible.",
  );
  assert.deepEqual(
    revisions.map((revision) => ({
      subject: revision.commit.subject,
      status: revision.status[0],
      oldPath: revision.oldPath,
      path: revision.path,
    })),
    [
      {
        subject: "delete file",
        status: "D",
        oldPath: undefined,
        path: "new name.txt",
      },
      {
        subject: "modify file",
        status: "M",
        oldPath: undefined,
        path: "new name.txt",
      },
      {
        subject: "rename file",
        status: "R",
        oldPath: "old name.txt",
        path: "new name.txt",
      },
      {
        subject: "add file",
        status: "A",
        oldPath: undefined,
        path: "old name.txt",
      },
    ],
  );
});

test("GitClient classifies file history endpoint metadata in batches", async (context) => {
  const repository = mkdtempSync(
    join(tmpdir(), "git-amida-file-history-metadata-test-"),
  );
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "seed.txt"), "seed\n");
  git(repository, "add", "--", "seed.txt");
  git(repository, "commit", "-q", "-m", "seed");
  const seed = git(repository, "rev-parse", "HEAD").trim();

  writeFileSync(join(repository, "large.txt"), "larger than limit\n");
  writeFileSync(join(repository, "tracked-lfs.dat"), gitLfsPointer("3", 2048));
  git(repository, "add", "--", "large.txt", "tracked-lfs.dat");
  git(
    repository,
    "update-index",
    "--add",
    "--cacheinfo",
    "160000",
    seed,
    "vendor/module",
  );
  git(repository, "commit", "-q", "-m", "add metadata files");
  unlinkSync(join(repository, "tracked-lfs.dat"));
  git(repository, "add", "--", "tracked-lfs.dat");
  git(repository, "commit", "-q", "-m", "delete lfs file");

  const client = new GitClient();
  const lfsRevisions = await client.fileHistory(repository, "tracked-lfs.dat");
  assert.deepEqual(
    lfsRevisions.map((revision) => ({
      subject: revision.commit.subject,
      status: revision.status[0],
      lfs: revision.lfs,
    })),
    [
      { subject: "delete lfs file", status: "D", lfs: true },
      { subject: "add metadata files", status: "A", lfs: true },
    ],
  );

  const largeRevision = (
    await client.fileHistory(repository, "large.txt", 5)
  )[0];
  assert.deepEqual(largeRevision?.content, {
    kind: "oversized",
    size: Buffer.byteLength("larger than limit\n"),
  });

  const submoduleRevision = (
    await client.fileHistory(repository, "vendor/module")
  )[0];
  assert.deepEqual(submoduleRevision?.content, { kind: "submodule" });
});

test("parseNulPaths preserves spaces and non-ASCII paths", () => {
  assert.deepEqual(
    parseNulPaths(Buffer.from("space name.txt\x00日本語.txt\x00")),
    ["space name.txt", "日本語.txt"],
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
  git(
    repository,
    "commit",
    "-q",
    "-m",
    "second commit",
    "-m",
    "Explain the repository change.\n\nPreserve the second paragraph.",
  );
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
  assert.equal(
    newest.body,
    "Explain the repository change.\n\nPreserve the second paragraph.",
  );
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

test("GitClient loads saved tracked and untracked working tree changes", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-working-tree-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "modified.txt"), "base\n");
  writeFileSync(join(repository, "staged.txt"), "base\n");
  writeFileSync(join(repository, "deleted.txt"), "delete me\n");
  writeFileSync(join(repository, "old name.txt"), "rename me\n");
  writeFileSync(join(repository, "tracked-lfs.dat"), gitLfsPointer("1", 18));
  git(repository, "add", "--", ".");
  git(repository, "commit", "-q", "-m", "base");
  const headHash = git(repository, "rev-parse", "HEAD").trim();

  writeFileSync(join(repository, "modified.txt"), "working\n");
  writeFileSync(join(repository, "staged.txt"), "staged\n");
  git(repository, "add", "--", "staged.txt");
  rmSync(join(repository, "deleted.txt"));
  renameSync(
    join(repository, "old name.txt"),
    join(repository, "renamed name.txt"),
  );
  git(repository, "add", "--", "old name.txt", "renamed name.txt");
  writeFileSync(join(repository, "日本語 space.txt"), "untracked\n");
  writeFileSync(join(repository, "untracked.bin"), Buffer.from([0, 1, 2]));
  writeFileSync(join(repository, "tracked-lfs.dat"), "resolved lfs data\n");

  const client = new GitClient();
  const state = await client.workingTreeChanges(repository, headHash);
  assert.equal(state.headHash, headHash);
  const files = new Map(state.files.map((file) => [file.path, file]));
  assert.equal(files.get("modified.txt")?.status, "M");
  assert.equal(files.get("staged.txt")?.status, "M");
  assert.equal(files.get("deleted.txt")?.status, "D");
  assert.match(files.get("renamed name.txt")?.status ?? "", /^R/);
  assert.equal(files.get("renamed name.txt")?.oldPath, "old name.txt");
  assert.equal(files.get("日本語 space.txt")?.status, "A");
  assert.equal(files.get("tracked-lfs.dat")?.lfs, true);
  assert.deepEqual(files.get("untracked.bin")?.content, {
    kind: "binary",
    size: 3,
  });
  assert.equal(
    (await client.readWorkingFile(repository, "日本語 space.txt")).toString(
      "utf8",
    ),
    "untracked\n",
  );
  await assert.rejects(
    client.readWorkingFile(repository, "../outside.txt"),
    /outside the repository/,
  );
});

test("GitClient fingerprints only history-affecting repository state", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-refresh-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "tracked.txt"), "base\n");
  git(repository, "add", "--", "tracked.txt");
  git(repository, "commit", "-q", "-m", "base");
  git(repository, "branch", "other");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const initial = await client.historyFingerprint(repository);
  assert.equal(history.historyFingerprint, initial);

  writeFileSync(join(repository, "tracked.txt"), "working tree only\n");
  assert.equal(await client.historyFingerprint(repository), initial);
  git(repository, "restore", "--", "tracked.txt");

  git(repository, "switch", "-q", "other");
  const switched = await client.historyFingerprint(repository);
  assert.notEqual(switched, initial);

  git(repository, "update-ref", "refs/remotes/origin/other", "HEAD");
  const fetched = await client.historyFingerprint(repository);
  assert.notEqual(fetched, switched);

  writeFileSync(join(repository, "tracked.txt"), "committed\n");
  git(repository, "add", "--", "tracked.txt");
  git(repository, "commit", "-q", "-m", "next");
  assert.notEqual(await client.historyFingerprint(repository), fetched);
});

test("GitClient includes linked worktree HEADs and fingerprints their commits", async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "git-amida-worktree-history-test-"));
  const repository = join(fixture, "main");
  const reviewWorktree = join(fixture, "review worktree");
  const agentWorktree = join(fixture, "agent worktree");
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(repository);
  git(repository, "init", "-q", "-b", "main");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  writeFileSync(join(repository, "tracked.txt"), "base\n");
  git(repository, "add", "--", "tracked.txt");
  git(repository, "commit", "-q", "-m", "base");
  git(repository, "branch", "release/preview");
  git(repository, "worktree", "add", "-q", reviewWorktree, "release/preview");
  git(repository, "worktree", "add", "-q", "--detach", agentWorktree, "HEAD");

  writeFileSync(join(agentWorktree, "agent.txt"), "detached task\n");
  git(agentWorktree, "add", "--", "agent.txt");
  git(agentWorktree, "commit", "-q", "-m", "detached agent commit");

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  const bySubject = new Map(
    history.rows.map((row) => [row.commit.subject, row.commit]),
  );
  assert.deepEqual(bySubject.get("detached agent commit")?.worktrees, [
    {
      path: realpathSync(agentWorktree),
      detached: true,
    },
  ]);
  assert.deepEqual(bySubject.get("base")?.worktrees, [
    {
      path: realpathSync(reviewWorktree),
      branch: "release/preview",
      detached: false,
    },
  ]);

  const initialFingerprint = history.historyFingerprint;
  writeFileSync(join(agentWorktree, "agent.txt"), "uncommitted task\n");
  assert.equal(
    await client.historyFingerprint(repository),
    initialFingerprint,
  );
  git(agentWorktree, "add", "--", "agent.txt");
  git(agentWorktree, "commit", "-q", "-m", "advance detached agent");
  assert.notEqual(
    await client.historyFingerprint(repository),
    initialFingerprint,
  );

  const refreshed = await client.loadHistory(repository);
  const advanced = refreshed.rows.find(
    (row) => row.commit.subject === "advance detached agent",
  );
  assert.deepEqual(advanced?.commit.worktrees, [
    {
      path: realpathSync(agentWorktree),
      detached: true,
    },
  ]);

  const fromAgentWorktree = await client.loadHistory(agentWorktree);
  assert.equal(fromAgentWorktree.repository.detached, true);
  assert.equal(fromAgentWorktree.repository.head, advanced?.commit.hash);
  assert.equal(
    fromAgentWorktree.rows.find(
      (row) => row.commit.subject === "advance detached agent",
    )?.commit.worktrees,
    undefined,
  );
  assert.deepEqual(
    fromAgentWorktree.rows.find((row) => row.commit.subject === "base")?.commit
      .worktrees,
    [
      {
        path: realpathSync(repository),
        branch: "main",
        detached: false,
      },
      {
        path: realpathSync(reviewWorktree),
        branch: "release/preview",
        detached: false,
      },
    ],
  );
});

test("GitClient pages all branch, remote, and tag history without a product limit", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-history-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  let parent: string | undefined;
  for (let index = 0; index < 205; index += 1) {
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

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  assert.equal(history.rows.length, 100);
  assert.equal(history.hasMore, true);
  assert.equal(history.cursor.offset, 100);

  const next = await client.loadNextHistoryPage(history.cursor);
  assert.equal(next.commits.length, 100);
  assert.equal(next.hasMore, true);
  assert.equal(next.cursor.offset, 200);
  const last = await client.loadNextHistoryPage(next.cursor);
  assert.equal(last.commits.length, 8);
  assert.equal(last.hasMore, false);
  assert.equal(last.cursor.offset, 208);
  const nextGraph = buildHistoryGraph(next.commits, history.graphState);
  const lastGraph = buildHistoryGraph(last.commits, nextGraph.state);
  assertHistoryGraphBounds(
    [...history.rows, ...nextGraph.rows, ...lastGraph.rows],
    lastGraph.laneCount,
  );
  const hashes = new Set([
    ...history.rows.map((row) => row.commit.hash),
    ...next.commits.map((commit) => commit.hash),
    ...last.commits.map((commit) => commit.hash),
  ]);
  assert.equal(hashes.size, 208);
  assert.equal(hashes.has(parent), true);
  assert.equal(hashes.has(side), true);
  assert.equal(hashes.has(remote), true);
  assert.equal(hashes.has(tagged), true);
  assert.equal(hashes.has(stashed), false);
});

test("GitClient preserves a merge that crosses the 100-commit page boundary", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-page-merge-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  const timestamp = (hour: number): string =>
    new Date(Date.UTC(2026, 0, 1, hour)).toISOString();
  const root = commitTree(repository, "root", timestamp(0));
  const left = commitTree(repository, "left parent", timestamp(1), root);
  const right = commitTree(repository, "right parent", timestamp(2), root);
  const merge = commitTree(
    repository,
    "boundary merge",
    timestamp(3),
    left,
    right,
  );

  let tip = merge;
  for (let index = 0; index < 98; index += 1) {
    tip = commitTree(
      repository,
      `newer commit ${index}`,
      timestamp(index + 4),
      tip,
    );
  }
  git(repository, "update-ref", "refs/heads/main", tip);

  const client = new GitClient();
  const first = await client.loadHistory(repository);
  assert.equal(first.rows.length, 100);
  assert.equal(first.hasMore, true);
  assert.equal(first.rows[98]?.commit.hash, merge);
  assert.equal(
    first.rows[98]?.graph.lines.filter((line) => line.from === "node").length,
    2,
  );

  const firstPageHashes = new Set(first.rows.map((row) => row.commit.hash));
  const visibleParents = [left, right].filter((hash) => firstPageHashes.has(hash));
  const pendingParents = [left, right].filter((hash) => !firstPageHashes.has(hash));
  assert.equal(visibleParents.length, 1);
  assert.equal(pendingParents.length, 1);
  assert.equal(first.rows[99]?.commit.hash, visibleParents[0]);

  const retainedRows = structuredClone(first.rows);
  const second = await client.loadNextHistoryPage(first.cursor);
  const appendedGraph = buildHistoryGraph(second.commits, first.graphState);
  const combinedRows = [...first.rows, ...appendedGraph.rows];

  assert.equal(second.hasMore, false);
  assert.equal(second.commits.length, 2);
  assert.equal(second.commits[0]?.hash, pendingParents[0]);
  assert.equal(second.commits[1]?.hash, root);
  assert.deepEqual(first.rows, retainedRows);
  const boundaryContinuation = first.rows[99]?.graph.lines.find(
    (line) => line.from === "top" && line.to === "bottom",
  );
  assert.ok(boundaryContinuation);
  assert.ok(
    appendedGraph.rows[0]?.graph.lines.some(
      (line) =>
        line.from === "top" &&
        line.to === "node" &&
        line.fromLane === boundaryContinuation.toLane &&
        line.color === boundaryContinuation.color,
    ),
  );
  assert.equal(new Set(combinedRows.map((row) => row.commit.hash)).size, 102);
  assertHistoryGraphBounds(combinedRows, appendedGraph.laneCount);
});

test("GitClient rejects a stale history cursor after refs change", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-history-cursor-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  let parent: string | undefined;
  for (let index = 0; index < 101; index += 1) {
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

  const client = new GitClient();
  const history = await client.loadHistory(repository);
  assert.equal(history.hasMore, true);
  const moved = git(
    repository,
    "commit-tree",
    EMPTY_TREE,
    "-p",
    parent,
    "-m",
    "moved ref",
  ).trim();
  git(repository, "update-ref", "refs/heads/main", moved);

  await assert.rejects(
    client.loadNextHistoryPage(history.cursor),
    HistoryChangedError,
  );
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

test("GitClient classifies changed content before opening a diff", async (context) => {
  const textDiffLimit = 5 * 1024 * 1024;
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
  writeFileSync(join(repository, "drawing.svg"), "<svg></svg>\n");
  writeFileSync(join(repository, "alternate.jpe"), Buffer.from([0xff, 0xd8]));
  writeFileSync(join(repository, "legacy.heic"), Buffer.from([1, 0, 2]));
  writeFileSync(join(repository, "legacy.tiff"), Buffer.from([1, 0, 2]));
  writeFileSync(
    join(repository, "large.txt"),
    Buffer.alloc(textDiffLimit + 1, "a"),
  );
  writeFileSync(join(repository, "tracked-lfs.dat"), gitLfsPointer("2", 1234));
  git(
    repository,
    "add",
    "--",
    "archive.bin",
    "photo.png",
    "drawing.svg",
    "alternate.jpe",
    "legacy.heic",
    "legacy.tiff",
    "large.txt",
    "tracked-lfs.dat",
  );
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
    textDiffLimit,
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
  assert.deepEqual(byPath.get("drawing.svg"), {
    status: "A",
    path: "drawing.svg",
    content: { kind: "image", size: 12 },
  });
  assert.deepEqual(byPath.get("alternate.jpe"), {
    status: "A",
    path: "alternate.jpe",
    content: { kind: "image", size: 2 },
  });
  assert.deepEqual(byPath.get("legacy.heic"), {
    status: "A",
    path: "legacy.heic",
    content: { kind: "binary", size: 3 },
  });
  assert.deepEqual(byPath.get("legacy.tiff"), {
    status: "A",
    path: "legacy.tiff",
    content: { kind: "binary", size: 3 },
  });
  assert.deepEqual(byPath.get("large.txt"), {
    status: "A",
    path: "large.txt",
    content: { kind: "oversized", size: textDiffLimit + 1 },
  });
  assert.deepEqual(byPath.get("tracked-lfs.dat"), {
    status: "A",
    path: "tracked-lfs.dat",
    lfs: true,
  });
  assert.deepEqual(byPath.get("vendor/module"), {
    status: "A",
    path: "vendor/module",
    content: { kind: "submodule" },
  });
});

test("GitClient reads image bytes beyond the normal Git output buffer", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-large-image-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  const image = createBmp(4096, 1366, 0x33);
  assert.ok(image.byteLength > 16 * 1024 * 1024);
  writeFileSync(join(repository, "large.bmp"), image);
  git(repository, "add", "--", "large.bmp");
  git(repository, "commit", "-q", "-m", "large image");
  const commit = git(repository, "rev-parse", "HEAD").trim();

  const client = new GitClient();
  const size = await client.blobSize(repository, commit, "large.bmp");
  assert.equal(size, image.byteLength);
  assert.equal(
    (await client.readBlob(repository, commit, "large.bmp", size)).byteLength,
    image.byteLength,
  );

  const changedImage = createBmp(4096, 1367, 0x66);
  writeFileSync(join(repository, "large.bmp"), changedImage);
  assert.equal(
    (await client.readWorkingBlob(repository, "large.bmp")).byteLength,
    changedImage.byteLength,
  );
  assert.equal(
    (
      await client.readWorkingFile(
        repository,
        "large.bmp",
        changedImage.byteLength,
      )
    ).byteLength,
    changedImage.byteLength,
  );
  await assert.rejects(
    client.readWorkingFile(repository, "large.bmp", image.byteLength),
    /current text-diff limit/,
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

test("explicit Selection uses history endpoints for unrelated branch changes", async (context) => {
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
  assert.deepEqual(shared.comparison, {
    beforeRef: side.parents[0],
    afterRef: main.hash,
    beforePath: "shared.txt",
    afterPath: "shared.txt",
    status: "M",
  });
  assert.deepEqual(
    shared.file.selection?.changes.map((change) => change.commitHash),
    [main.hash, side.hash],
  );
});

test("explicit Selection excludes omitted-only files but spans omitted same-file changes", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-selection-gap-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");

  const rootContent = [
    "alpha = base",
    "beta = base",
    "gamma = base",
    "",
  ].join("\n");
  writeFileSync(join(repository, "shared.txt"), rootContent);
  git(repository, "add", "--", "shared.txt");
  git(repository, "commit", "-q", "-m", "root");
  writeFileSync(
    join(repository, "shared.txt"),
    rootContent.replace("alpha = base", "alpha = selected old"),
  );
  git(repository, "commit", "-q", "-am", "selected old");
  const selectedOld = git(repository, "rev-parse", "HEAD").trim();
  writeFileSync(
    join(repository, "shared.txt"),
    rootContent
      .replace("alpha = base", "alpha = selected old")
      .replace("beta = base", "beta = omitted"),
  );
  writeFileSync(join(repository, "omitted-only.txt"), "omitted\n");
  git(repository, "add", "--", "shared.txt", "omitted-only.txt");
  git(repository, "commit", "-q", "-m", "omitted");
  const selectedNewContent = rootContent
    .replace("alpha = base", "alpha = selected old")
    .replace("beta = base", "beta = omitted")
    .replace("gamma = base", "gamma = selected new");
  writeFileSync(join(repository, "shared.txt"), selectedNewContent);
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
  assert.deepEqual(states[0]?.comparison, {
    beforeRef: oldCommit.parents[0],
    afterRef: selectedNew,
    beforePath: "shared.txt",
    afterPath: "shared.txt",
    status: "M",
  });
  assert.equal(
    (
      await client.readBlob(
        repository,
        states[0]?.comparison.beforeRef,
        "shared.txt",
      )
    ).toString(),
    rootContent,
  );
  assert.equal(
    (
      await client.readBlob(
        repository,
        states[0]?.comparison.afterRef,
        "shared.txt",
      )
    ).toString(),
    selectedNewContent,
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

test("GitClient loads octopus and criss-cross ancestry with bounded graph lanes", async (context) => {
  const repository = mkdtempSync(join(tmpdir(), "git-amida-complex-graph-test-"));
  context.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  const timestamp = "2026-08-02T00:00:00Z";
  const root = commitTree(repository, "root", timestamp);
  const leftBase = commitTree(repository, "left base", timestamp, root);
  const rightBase = commitTree(repository, "right base", timestamp, root);
  const thirdBase = commitTree(repository, "third base", timestamp, root);
  const leftMerge = commitTree(
    repository,
    "left merge",
    timestamp,
    leftBase,
    rightBase,
  );
  const rightMerge = commitTree(
    repository,
    "right merge",
    timestamp,
    rightBase,
    leftBase,
  );
  const crissCrossTip = commitTree(
    repository,
    "criss-cross tip",
    timestamp,
    leftMerge,
    rightMerge,
  );
  const octopusTip = commitTree(
    repository,
    "octopus tip",
    timestamp,
    leftBase,
    rightBase,
    thirdBase,
  );
  git(repository, "update-ref", "refs/heads/main", crissCrossTip);
  git(repository, "update-ref", "refs/heads/octopus", octopusTip);

  const history = await new GitClient().loadHistory(repository);
  const rowByHash = new Map(
    history.rows.map((row, index) => [row.commit.hash, { row, index }]),
  );

  assert.equal(history.rows.length, 8);
  assert.deepEqual(rowByHash.get(octopusTip)?.row.commit.parents, [
    leftBase,
    rightBase,
    thirdBase,
  ]);
  assert.deepEqual(rowByHash.get(crissCrossTip)?.row.commit.parents, [
    leftMerge,
    rightMerge,
  ]);
  assert.deepEqual(rowByHash.get(leftMerge)?.row.commit.parents, [
    leftBase,
    rightBase,
  ]);
  assert.deepEqual(rowByHash.get(rightMerge)?.row.commit.parents, [
    rightBase,
    leftBase,
  ]);
  assertHistoryGraphBounds(history.rows, history.graphLaneCount);
  for (const [childIndex, row] of history.rows.entries()) {
    for (const parent of row.commit.parents) {
      const parentIndex = rowByHash.get(parent)?.index;
      assert.ok(parentIndex !== undefined && parentIndex > childIndex);
    }
  }
});

test("GitClient loads a shallow history boundary as a valid graph root", async (context) => {
  const fixture = mkdtempSync(join(tmpdir(), "git-amida-shallow-graph-test-"));
  const source = join(fixture, "source");
  const shallow = join(fixture, "shallow");
  context.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(source);
  git(source, "init", "-q");
  git(source, "config", "user.name", "GitAmida Test");
  git(source, "config", "user.email", "test@example.invalid");
  git(source, "symbolic-ref", "HEAD", "refs/heads/main");

  let parent: string | undefined;
  for (let index = 0; index < 5; index += 1) {
    parent = git(
      source,
      "commit-tree",
      EMPTY_TREE,
      ...(parent === undefined ? [] : ["-p", parent]),
      "-m",
      `commit ${index}`,
    ).trim();
  }
  assert.ok(parent);
  git(source, "update-ref", "refs/heads/main", parent);
  execFileSync(
    "git",
    ["clone", "-q", "--depth", "2", pathToFileURL(source).href, shallow],
    {
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
  );

  const history = await new GitClient().loadHistory(shallow);

  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[1]?.commit.parents.length, 0);
  assertHistoryGraphBounds(history.rows, history.graphLaneCount);
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
  assert.deepEqual(
    resolveVisibleSelection(
      new Map(
        history.rows.map((row) => [row.commit.hash, row.commit]),
      ),
      mainEarly,
      mainTip,
    ),
    {
      mode: "selection",
      activeHash: mainTip,
      anchorHash: mainEarly,
      commitHashes: [mainTip, sideTip, sideMiddle, mainEarly],
    },
  );
});

function commitTree(
  repository: string,
  message: string,
  timestamp: string,
  ...parents: string[]
): string {
  return execFileSync(
    "git",
    [
      "-C",
      repository,
      "commit-tree",
      EMPTY_TREE,
      ...parents.flatMap((parent) => ["-p", parent]),
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

function assertHistoryGraphBounds(
  rows: readonly HistoryRow[],
  laneCount: number,
): void {
  assert.ok(laneCount >= 1);
  for (const row of rows) {
    assert.ok(row.graph.nodeLane >= 0 && row.graph.nodeLane < laneCount);
    assert.ok(row.graph.nodeColor >= 0 && row.graph.nodeColor < 5);
    for (const line of row.graph.lines) {
      assert.ok(line.fromLane >= 0 && line.fromLane < laneCount);
      assert.ok(line.toLane >= 0 && line.toLane < laneCount);
      assert.ok(line.color >= 0 && line.color < 5);
    }
  }
}

function createBmp(width: number, height: number, shade: number): Buffer {
  const headerSize = 54;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const image = Buffer.alloc(headerSize + pixelSize);
  image.write("BM", 0, "ascii");
  image.writeUInt32LE(image.byteLength, 2);
  image.writeUInt32LE(headerSize, 10);
  image.writeUInt32LE(40, 14);
  image.writeInt32LE(width, 18);
  image.writeInt32LE(height, 22);
  image.writeUInt16LE(1, 26);
  image.writeUInt16LE(24, 28);
  image.writeUInt32LE(pixelSize, 34);
  image.fill(shade, headerSize);
  return image;
}

function gitLfsPointer(oidDigit: string, size: number): string {
  return [
    "version https://git-lfs.github.com/spec/v1",
    `oid sha256:${oidDigit.repeat(64)}`,
    `size ${size}`,
    "",
  ].join("\n");
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
