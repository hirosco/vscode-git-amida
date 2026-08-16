#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/create-operation-conflict-demo-repositories.mjs /absolute/path/to/vscode-git-amida-conflict-demo",
  );
}

const targetPrefix = resolve(process.argv[2]);
const targets = {
  cherryPick: `${targetPrefix}-cherry-pick`,
  revert: `${targetPrefix}-revert`,
  stash: `${targetPrefix}-stash`,
};

for (const path of Object.values(targets)) {
  if (existsSync(path)) {
    throw new Error(
      `Refusing to overwrite existing path: ${path}\n` +
        "Move or remove all three exact operation fixture paths explicitly, then run the generator again.",
    );
  }
}

const identity = {
  name: "GitAmida Conflict Demo",
  email: "conflict-demo@git-amida.invalid",
};

function environment(date) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
    LANG: "C",
    LC_ALL: "C",
    ...(date === undefined
      ? {}
      : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }),
  };
}

function git(repository, args, date) {
  return execFileSync(
    "git",
    ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args],
    {
      cwd: repository,
      encoding: "utf8",
      env: environment(date),
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function expectConflict(repository, args) {
  const result = spawnSync(
    "git",
    ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args],
    {
      cwd: repository,
      encoding: "utf8",
      env: environment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 1 || !output.includes("CONFLICT")) {
    throw new Error(
      `Expected Git to stop at a conflict while running: git ${args.join(" ")}\n${output}`,
    );
  }
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

function commit(repository, subject, date) {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "-q", "-m", subject], date);
  return git(repository, ["rev-parse", "HEAD"]);
}

function initialize(repository, operation, validation) {
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-q", "-b", "main"]);
  git(repository, ["config", "user.name", identity.name]);
  git(repository, ["config", "user.email", identity.email]);
  git(repository, ["config", "commit.gpgsign", "false"]);
  git(repository, ["config", "core.autocrlf", "false"]);
  git(repository, ["config", "merge.conflictStyle", "diff3"]);
  git(repository, ["config", "rerere.enabled", "false"]);
  write(
    repository,
    "README.md",
    `# GitAmida ${operation} conflict demo\n\nThis disposable repository contains only synthetic content and is intentionally left with an unresolved ${operation} conflict.\n\nOpen it as a Cursor or VS Code workspace, compare Source Control with GitAmida, and preserve the unresolved state while evaluating the extension. Regenerate the repository after any mutation.\n`,
  );
  write(
    repository,
    "VALIDATION.md",
    `# Validation guide\n\n${validation}\n\nConfirm that Source Control and GitAmida both show one file under **Merge Changes**, while ordinary **Changes** remains empty. Do not continue, abort, stage, or resolve the operation if the fixture needs to remain reusable.\n`,
  );
}

function createCherryPickFixture(repository) {
  initialize(
    repository,
    "cherry-pick",
    "GitAmida should show **Cherry-pick in progress · 1 conflict**. Selecting `src/cherry-pick-content.txt` should open the host editor's native content-conflict flow.",
  );
  write(repository, "src/cherry-pick-content.txt", "shared cherry-pick base\n");
  const base = commit(
    repository,
    "chore: initialize cherry-pick fixture",
    "2026-08-06T09:00:00+09:00",
  );
  git(repository, ["switch", "-q", "-c", "cherry-pick/topic", base]);
  write(repository, "src/cherry-pick-content.txt", "picked topic content\n");
  const pickedCommit = commit(
    repository,
    "feat: add cherry-pick topic change",
    "2026-08-07T09:00:00+09:00",
  );
  git(repository, ["switch", "-q", "main"]);
  write(repository, "src/cherry-pick-content.txt", "current main content\n");
  commit(
    repository,
    "feat: add conflicting main change",
    "2026-08-08T09:00:00+09:00",
  );
  expectConflict(repository, ["cherry-pick", pickedCommit]);
}

function createRevertFixture(repository) {
  initialize(
    repository,
    "revert",
    "GitAmida should show **Revert in progress · 1 conflict**. Selecting `src/revert-content.txt` should open the host editor's native content-conflict flow.",
  );
  write(repository, "src/revert-content.txt", "shared revert base\n");
  commit(
    repository,
    "chore: initialize revert fixture",
    "2026-08-09T09:00:00+09:00",
  );
  write(repository, "src/revert-content.txt", "change selected for revert\n");
  const revertedCommit = commit(
    repository,
    "feat: add change selected for revert",
    "2026-08-10T09:00:00+09:00",
  );
  write(repository, "src/revert-content.txt", "later conflicting content\n");
  commit(
    repository,
    "feat: add later conflicting change",
    "2026-08-11T09:00:00+09:00",
  );
  expectConflict(repository, ["revert", "--no-edit", revertedCommit]);
}

function createStashFixture(repository) {
  initialize(
    repository,
    "stash-apply",
    "GitAmida should show **1 conflict** without guessing an operation name. Selecting `src/stash-content.txt` should open the host editor's native content-conflict flow.",
  );
  write(repository, "src/stash-content.txt", "shared stash base\n");
  commit(
    repository,
    "chore: initialize stash fixture",
    "2026-08-12T09:00:00+09:00",
  );
  write(repository, "src/stash-content.txt", "stashed working content\n");
  git(repository, ["stash", "push", "-q", "-m", "conflicting stash"]);
  write(repository, "src/stash-content.txt", "current committed content\n");
  commit(
    repository,
    "feat: add conflicting committed change",
    "2026-08-13T09:00:00+09:00",
  );
  expectConflict(repository, ["stash", "apply", "stash@{0}"]);
}

createCherryPickFixture(targets.cherryPick);
createRevertFixture(targets.revert);
createStashFixture(targets.stash);

for (const [operation, repository] of Object.entries(targets)) {
  if (git(repository, ["ls-files", "--unmerged"]) === "") {
    throw new Error(`Generated ${operation} repository has no unmerged entries.`);
  }
  git(repository, ["fsck", "--full"]);
  console.log(`Created ${operation} conflict repository: ${repository}`);
}
