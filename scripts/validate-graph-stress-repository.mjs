#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { GitClient } from "../dist/src/git.js";
import { buildHistoryGraph } from "../dist/src/graph.js";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/validate-graph-stress-repository.mjs /absolute/path/to/vscode-git-amida-graph-stress-demo",
  );
}

const repository = resolve(process.argv[2]);
if (!existsSync(repository)) {
  throw new Error(`Graph stress repository does not exist: ${repository}`);
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
const root = loadedRows.find(
  (row) => row.commit.subject === "stress: shared root",
);

assert.equal(firstPage.repository.root, repository);
assert.equal(firstPage.repository.branch, "main");
assert.equal(firstPage.repository.detached, false);
assert.equal(loadedRows.length, 64);
assert.equal(graphState.laneCount, 24);
assert.equal(maximumLaneCount, 24);
assert.ok(maximumLaneRows >= 40);
for (const expected of [4, 8, 12, 16, 24]) {
  assert.ok(
    rowLaneCounts.includes(expected),
    `Expected a row with ${expected} simultaneous lanes.`,
  );
}
assert.equal(
  loadedRows[0]?.commit.subject,
  "stress: anchor current head",
);
assert.ok(root);
assert.equal(
  root.graph.lines.filter((line) => line.to === "node").length,
  24,
);
assert.equal(
  execFileSync("git", ["status", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  }).trim(),
  "",
);

const formattedDistribution = [...distribution.entries()]
  .sort(([left], [right]) => left - right)
  .map(([lanes, rows]) => `${lanes}:${rows}`)
  .join(", ");

console.log(`Validated GitAmida graph stress repository: ${repository}`);
console.log(`History rows: ${loadedRows.length}`);
console.log(`Maximum graph lanes: ${maximumLaneCount}`);
console.log(`Rows at maximum: ${maximumLaneRows}`);
console.log(`Lane distribution (lanes:rows): ${formattedDistribution}`);
