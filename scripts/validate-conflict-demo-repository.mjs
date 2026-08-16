#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitClient } from "../dist/src/git.js";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/validate-conflict-demo-repository.mjs /absolute/path/to/vscode-git-amida-conflict-demo",
  );
}

const repository = resolve(process.argv[2]);
const rebaseWorktree = `${repository}-rebase`;

for (const path of [repository, rebaseWorktree]) {
  if (!existsSync(path)) {
    throw new Error(`Conflict fixture does not exist: ${path}`);
  }
}

function git(worktree, args) {
  return execFileSync(
    "git",
    ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args],
    {
      cwd: worktree,
      encoding: "utf8",
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function gitPath(worktree, name) {
  return resolve(worktree, git(worktree, ["rev-parse", "--git-path", name]));
}

function unmergedPaths(worktree) {
  return new Set(
    git(worktree, ["ls-files", "--unmerged", "-z"])
      .split("\0")
      .filter((field) => field.length > 0)
      .map((field) => field.slice(field.indexOf("\t") + 1)),
  );
}

assert.ok(existsSync(gitPath(repository, "MERGE_HEAD")));
assert.ok(
  existsSync(gitPath(rebaseWorktree, "rebase-merge")) ||
    existsSync(gitPath(rebaseWorktree, "rebase-apply")),
);
assert.equal(git(repository, ["branch", "--show-current"]), "main");
assert.equal(git(rebaseWorktree, ["branch", "--show-current"]), "");
assert.deepEqual(
  [...unmergedPaths(repository)].sort(),
  ["src/merge-content.txt", "src/merge-delete.txt"],
);
assert.deepEqual([...unmergedPaths(rebaseWorktree)], [
  "src/rebase-content.txt",
]);
assert.match(
  readFileSync(resolve(repository, "src/merge-content.txt"), "utf8"),
  /^<<<<<<< /m,
);
assert.equal(
  readFileSync(resolve(repository, "src/merge-delete.txt"), "utf8"),
  "current main keeps this file\n",
);
assert.match(
  readFileSync(resolve(rebaseWorktree, "src/rebase-content.txt"), "utf8"),
  /^<<<<<<< /m,
);

const client = new GitClient();
const mergeHistory = await client.loadHistory(repository);
const mergeWorkingTree = await client.workingTreeChanges(
  repository,
  mergeHistory.repository.head,
);
const rebaseHistory = await client.loadHistory(rebaseWorktree);
const rebaseWorkingTree = await client.workingTreeChanges(
  rebaseWorktree,
  rebaseHistory.repository.head,
);

assert.equal(mergeHistory.repository.branch, "main");
assert.equal(mergeHistory.repository.detached, false);
assert.equal(rebaseHistory.repository.detached, true);
assert.ok(rebaseHistory.repository.branch.startsWith("detached at "));
assert.equal(mergeWorkingTree.operation, "merge");
assert.equal(rebaseWorkingTree.operation, "rebase");
assert.deepEqual(
  mergeWorkingTree.files.map((file) => [file.path, file.conflict?.status]),
  [
    ["src/merge-content.txt", "UU"],
    ["src/merge-delete.txt", "UD"],
  ],
);
assert.deepEqual(
  rebaseWorkingTree.files.map((file) => [file.path, file.conflict?.status]),
  [["src/rebase-content.txt", "UU"]],
);

console.log(`Validated GitAmida conflict repository: ${repository}`);
console.log(`Merge conflicts: ${unmergedPaths(repository).size}`);
console.log(`Rebase conflicts: ${unmergedPaths(rebaseWorktree).size}`);
console.log(`Rebase detached HEAD: ${rebaseHistory.repository.head}`);
console.log("Modify/delete conflict visible in Merge Changes: yes");
