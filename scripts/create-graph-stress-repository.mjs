#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/create-graph-stress-repository.mjs /absolute/path/to/git-amida-graph-stress-demo",
  );
}

const target = resolve(process.argv[2]);
if (existsSync(target)) {
  throw new Error(
    `Refusing to overwrite existing path: ${target}\n` +
      "Move or remove it explicitly, then run the generator again.",
  );
}

const identity = {
  name: "GitAmida Graph Stress Demo",
  email: "graph-stress@git-amida.invalid",
};

function git(repository, args, options = {}) {
  const date = options.date;
  return execFileSync(
    "git",
    ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args],
    {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
        ...(date === undefined
          ? {}
          : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
      },
      stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function pathIn(repository, path) {
  const fullPath = resolve(repository, path);
  if (fullPath !== repository && !fullPath.startsWith(`${repository}${sep}`)) {
    throw new Error(`Path escapes generated repository: ${path}`);
  }
  return fullPath;
}

function write(repository, path, content) {
  const fullPath = pathIn(repository, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function append(repository, path, content) {
  const fullPath = pathIn(repository, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  appendFileSync(fullPath, content);
}

function commit(repository, subject, date) {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "-q", "-m", subject], { date });
  return git(repository, ["rev-parse", "HEAD"]);
}

function detachedCommit(repository, tree, parent, subject, date) {
  return git(
    repository,
    ["commit-tree", tree, "-p", parent, "-m", subject],
    { date },
  );
}

function utcDay(year, monthIndex, day) {
  return new Date(Date.UTC(year, monthIndex, day, 9, 0, 0)).toISOString();
}

mkdirSync(target, { recursive: true });
git(target, ["init", "-q", "-b", "main"]);
git(target, ["config", "user.name", identity.name]);
git(target, ["config", "user.email", identity.email]);
git(target, ["config", "commit.gpgsign", "false"]);

write(target, ".gitignore", ".DS_Store\n");
write(
  target,
  "README.md",
  `# GitAmida graph stress demo

This disposable repository isolates dense Git graph rendering from GitAmida's normal validation repository. It contains synthetic commits only.

Open this repository in Cursor or VS Code, then open GitAmida in the bottom Panel. The default commit-date order intentionally shows:

- one current \`main\` HEAD
- 23 unmerged \`stress/lane-*\` tips that progressively raise the graph through 4, 8, 12, 16, and 24 simultaneous lanes
- a 39-commit main corridor where all 24 lanes remain active
- one shared root where every lane converges

Resize the Panel and the Repository History split while inspecting the 24-lane corridor. Check subject and date alignment, repeated graph colors, line separation, selection, scrolling, and automatic width changes.
`,
);
write(target, "fixtures/main-corridor.txt", "root\n");
const rootHash = commit(
  target,
  "stress: shared root",
  utcDay(2026, 0, 1),
);

for (let index = 1; index <= 39; index += 1) {
  const label = String(index).padStart(2, "0");
  append(target, "fixtures/main-corridor.txt", `${label}\n`);
  commit(
    target,
    `stress: extend main corridor ${label}`,
    utcDay(2026, 0, 1 + index),
  );
}

const rootTree = git(target, ["rev-parse", `${rootHash}^{tree}`]);
for (let index = 1; index <= 23; index += 1) {
  const label = String(index).padStart(2, "0");
  const tip = detachedCommit(
    target,
    rootTree,
    rootHash,
    `stress: open lane ${label}`,
    utcDay(2026, 2, index),
  );
  git(target, ["update-ref", `refs/heads/stress/lane-${label}`, tip]);
}

append(target, "fixtures/main-corridor.txt", "HEAD\n");
const headHash = commit(
  target,
  "stress: anchor current head",
  utcDay(2026, 3, 1),
);

const commitCount = Number(git(target, ["rev-list", "--branches", "--count"]));
const branchCount = Number(
  git(target, ["for-each-ref", "--format=%(refname)", "refs/heads"])
    .split("\n")
    .filter((line) => line.length > 0).length,
);
const status = git(target, ["status", "--porcelain"]);
const currentBranch = git(target, ["branch", "--show-current"]);
git(target, ["fsck", "--full"]);

if (commitCount !== 64) {
  throw new Error(`Expected 64 reachable commits, found ${commitCount}.`);
}
if (branchCount !== 24) {
  throw new Error(`Expected 24 local branches, found ${branchCount}.`);
}
if (status !== "") {
  throw new Error(`Generated repository is not clean:\n${status}`);
}
if (currentBranch !== "main") {
  throw new Error(`Expected current branch main, found ${currentBranch}.`);
}

console.log(`Created GitAmida graph stress repository: ${target}`);
console.log(`Reachable commits: ${commitCount}`);
console.log(`Local branches: ${branchCount}`);
console.log(`Current branch: ${currentBranch}`);
console.log(`Current HEAD: ${headHash}`);
