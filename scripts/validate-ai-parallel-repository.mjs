#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { GitClient } from "../dist/src/git.js";
import { buildHistoryGraph } from "../dist/src/graph.js";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/validate-ai-parallel-repository.mjs /absolute/path/to/git-amida-ai-parallel-demo",
  );
}

const repository = resolve(process.argv[2]);
const agentRoot = `${repository}-agents`;
if (!existsSync(repository)) {
  throw new Error(`AI parallel repository does not exist: ${repository}`);
}
if (!existsSync(agentRoot)) {
  throw new Error(`AI parallel worktree directory does not exist: ${agentRoot}`);
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

const rowLaneCounts = loadedRows.map((row) => {
  const laneIndexes = row.graph.lines.flatMap((line) => [
    line.fromLane,
    line.toLane,
  ]);
  return Math.max(row.graph.nodeLane, ...laneIndexes) + 1;
});
const distribution = new Map();
for (const laneCount of rowLaneCounts) {
  distribution.set(laneCount, (distribution.get(laneCount) ?? 0) + 1);
}
const maximumLaneCount = Math.max(...rowLaneCounts);
const maximumLaneRows = rowLaneCounts.filter(
  (laneCount) => laneCount === maximumLaneCount,
).length;
const commits = new Map(
  loadedRows.map((row) => [row.commit.subject, row.commit]),
);

assert.equal(firstPage.repository.root, repository);
assert.equal(firstPage.repository.branch, "main");
assert.equal(firstPage.repository.detached, false);
assert.equal(loadedRows.length, 37);
assert.equal(graphState.laneCount, maximumLaneCount);
assert.ok(maximumLaneCount >= 6, "Expected a realistic multi-worktree fan-out.");
assert.ok(maximumLaneCount <= 10, "Fixture should not become pathological.");
assert.ok(rowLaneCounts.some((laneCount) => laneCount >= 4));
assert.equal(
  loadedRows[0]?.commit.subject,
  "chore: coordinate eight active agent reviews",
);

const expectedWorktrees = [
  {
    slug: "search-index",
    subject: "fix: preserve renamed search entries",
    branch: "agent/search-index",
  },
  {
    slug: "api-cache",
    subject: "test: invalidate cached history pages",
    branch: "agent/api-cache",
  },
  {
    slug: "editor-copy",
    subject: "fix: keep copy action keyboard accessible",
    branch: "agent/editor-copy",
  },
  {
    slug: "accessibility",
    subject: "test: cover graph keyboard focus",
    branch: "agent/accessibility",
  },
  {
    slug: "file-icons",
    subject: "fix: retain icon contrast in dark themes",
    branch: "agent/file-icons",
  },
  {
    slug: "ref-labels",
    subject: "feat: simplify compact ref labels",
    branch: "agent/ref-labels",
  },
  {
    slug: "detached-selection",
    subject: "test: cover detached selection endpoints",
  },
  {
    slug: "detached-refresh",
    subject: "fix: debounce detached worktree refresh",
  },
];

for (const expected of expectedWorktrees) {
  const path = realpathSync(resolve(agentRoot, expected.slug));
  const commit = commits.get(expected.subject);
  assert.ok(commit, `Missing worktree tip: ${expected.subject}`);
  assert.deepEqual(commit.worktrees, [
    {
      path,
      ...(expected.branch === undefined ? {} : { branch: expected.branch }),
      detached: expected.branch === undefined,
    },
  ]);
  assert.equal(
    execFileSync("git", ["status", "--porcelain"], {
      cwd: path,
      encoding: "utf8",
    }).trim(),
    "",
  );
}

for (const subject of [
  "merge: integrate search preview",
  "merge: integrate generated command index",
  "merge: integrate graph theme tokens",
  "merge: integrate parallel history tests",
]) {
  assert.equal(commits.get(subject)?.parents.length, 2);
}

const localBranches = execFileSync(
  "git",
  ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
  { cwd: repository, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((line) => line.length > 0);
assert.equal(localBranches.length, 7);
assert.equal(
  localBranches.some((branch) => branch.startsWith("completed/")),
  false,
);
assert.equal(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  }).trim(),
  "",
);

const worktreeCount = execFileSync(
  "git",
  ["worktree", "list", "--porcelain", "-z"],
  { cwd: repository, encoding: "utf8" },
)
  .split("\0")
  .filter((field) => field.startsWith("worktree ")).length;
assert.equal(worktreeCount, 9);

const formattedDistribution = [...distribution.entries()]
  .sort(([left], [right]) => left - right)
  .map(([lanes, rows]) => `${lanes}:${rows}`)
  .join(", ");

console.log(`Validated GitAmida AI parallel repository: ${repository}`);
console.log(`History rows: ${loadedRows.length}`);
console.log(`Maximum graph lanes: ${maximumLaneCount}`);
console.log(`Rows at maximum: ${maximumLaneRows}`);
console.log(`Linked worktrees: ${worktreeCount - 1}`);
console.log(`Lane distribution (lanes:rows): ${formattedDistribution}`);
