#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { GitClient } from "../dist/src/git.js";
import { buildHistoryGraph } from "../dist/src/graph.js";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/validate-demo-repository.mjs /absolute/path/to/git-amida-demo",
  );
}

const repository = resolve(process.argv[2]);
const agentWorktree = `${repository}-agent`;
if (!existsSync(repository)) {
  throw new Error(`Demo repository does not exist: ${repository}`);
}
if (!existsSync(agentWorktree)) {
  throw new Error(`Detached agent worktree does not exist: ${agentWorktree}`);
}

const client = new GitClient();
const firstPage = await client.loadHistory(repository);
const loadedRows = [...firstPage.rows];
let graphState = firstPage.graphState;
let cursor = firstPage.cursor;
let hasMore = firstPage.hasMore;
while (hasMore) {
  const page = await client.loadNextHistoryPage(cursor);
  const nextGraph = buildHistoryGraph(page.commits, graphState);
  loadedRows.push(...nextGraph.rows);
  graphState = nextGraph.state;
  cursor = page.cursor;
  hasMore = page.hasMore;
}
const history = {
  ...firstPage,
  rows: loadedRows,
  graphLaneCount: graphState.laneCount,
  hasMore,
  cursor,
  graphState,
};
const commits = new Map(
  history.rows.map((row) => [row.commit.subject, row.commit]),
);

assert.equal(history.repository.root, repository);
assert.equal(history.repository.branch, "main");
assert.equal(history.repository.detached, false);
assert.equal(history.rows.length, 130);
assert.ok(history.graphLaneCount >= 4);

const agentWorktreeSubject = execFileSync(
  "git",
  ["log", "-1", "--format=%s"],
  { cwd: agentWorktree, encoding: "utf8" },
).trim();
assert.equal(agentWorktreeSubject, "feat: draft parallel agent workspace");
assert.equal(
  execFileSync("git", ["branch", "--show-current"], {
    cwd: agentWorktree,
    encoding: "utf8",
  }).trim(),
  "",
);
assert.equal(
  commits.has("feat: draft parallel agent workspace"),
  true,
);
assert.deepEqual(
  commits.get("feat: draft parallel agent workspace")?.worktrees,
  [{ path: agentWorktree, detached: true }],
);

const latest = commits.get("feat: publish seasonal collection");
assert.ok(latest);
assert.equal(history.repository.head, latest.hash);
assert.equal(
  latest.body,
  "Refresh the gallery artwork and release notes for the summer collection.\n\nKeep image, rename, and configuration changes together for review.",
);
assert.ok(latest.refs.some((ref) => ref.type === "tag" && ref.name === "v0.2.0"));

const remoteMain = commits.get("chore: remove legacy gallery assets");
assert.ok(remoteMain);
assert.ok(
  remoteMain.refs.some(
    (ref) => ref.type === "remoteBranch" && ref.name === "origin/main",
  ),
);
assert.equal(
  remoteMain.refs.find((ref) => ref.name === "origin/HEAD")?.symbolicTarget,
  "refs/remotes/origin/main",
);

const offlineMerge = commits.get("merge: integrate offline mode");
const visualMerge = commits.get("merge: integrate visual refresh");
assert.equal(offlineMerge?.parents.length, 2);
assert.equal(visualMerge?.parents.length, 2);

const rebased = commits.get("fix: refresh stale previews");
assert.ok(rebased);
assert.notEqual(rebased.authoredAt, rebased.committedAt);

const latestFiles = await client.changedFiles(
  repository,
  latest,
  50 * 1024 * 1024,
);
const latestByPath = new Map(latestFiles.map((file) => [file.path, file]));
assert.equal(latestFiles.length, 7);
assert.equal(latestByPath.get("assets/gallery.svg")?.content?.kind, "image");
assert.equal(latestByPath.get("assets/preview.bmp")?.content?.kind, "image");
assert.equal(latestByPath.get("docs/releases/summer-2026.md")?.status, "A");
assert.match(latestByPath.get("src/styles/palette.css")?.status ?? "", /^R/);
assert.equal(
  latestByPath.get("src/styles/palette.css")?.oldPath,
  "src/styles/theme.css",
);

const paletteHistory = await client.fileHistory(
  repository,
  "src/styles/palette.css",
);
assert.deepEqual(
  paletteHistory.map((revision) => revision.commit.subject),
  [
    "feat: publish seasonal collection",
    "merge: integrate visual refresh",
    "refactor: move theme styles",
    "feat: refresh gallery artwork",
    "chore: initialize aurora gallery",
  ],
);

const galleryHistory = await client.fileHistory(repository, "assets/gallery.svg");
assert.deepEqual(
  galleryHistory.map((revision) => revision.commit.subject),
  [
    "feat: publish seasonal collection",
    "merge: integrate visual refresh",
    "feat: refresh gallery artwork",
    "chore: initialize aurora gallery",
  ],
);

const large = commits.get("test: add large comparison fixtures");
assert.ok(large);
const largeFiles = await client.changedFiles(
  repository,
  large,
  50 * 1024 * 1024,
);
const largeByPath = new Map(largeFiles.map((file) => [file.path, file]));
assert.equal(
  largeByPath.get("fixtures/oversized.txt")?.content?.kind,
  "oversized",
);
assert.equal(
  largeByPath.get("assets/large-preview.bmp")?.content?.kind,
  "image",
);

const submodule = commits.get("chore: add sample widget submodule");
assert.ok(submodule);
const submoduleFiles = await client.changedFiles(repository, submodule);
assert.equal(
  submoduleFiles.find((file) => file.path === "vendor/sample-widget")?.content
    ?.kind,
  "submodule",
);

const workingTree = await client.workingTreeChanges(repository, latest.hash);
assert.deepEqual(workingTree.files, []);

console.log(`Validated GitAmida demo repository: ${repository}`);
console.log(`History rows: ${history.rows.length}`);
console.log(`Graph lanes: ${history.graphLaneCount}`);
console.log(`Latest changed files: ${latestFiles.length}`);
console.log(`Palette revisions: ${paletteHistory.length}`);
console.log(`Gallery revisions: ${galleryHistory.length}`);
console.log("Detached worktree commit visible: yes");
