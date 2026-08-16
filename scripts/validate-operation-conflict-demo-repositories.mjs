#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitClient } from "../dist/src/git.js";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/validate-operation-conflict-demo-repositories.mjs /absolute/path/to/vscode-git-amida-conflict-demo",
  );
}

const targetPrefix = resolve(process.argv[2]);
const fixtures = [
  {
    operation: "cherry-pick",
    repository: `${targetPrefix}-cherry-pick`,
    marker: "CHERRY_PICK_HEAD",
    path: "src/cherry-pick-content.txt",
  },
  {
    operation: "revert",
    repository: `${targetPrefix}-revert`,
    marker: "REVERT_HEAD",
    path: "src/revert-content.txt",
  },
  {
    operation: undefined,
    repository: `${targetPrefix}-stash`,
    marker: undefined,
    path: "src/stash-content.txt",
  },
];

function git(repository, args) {
  return execFileSync(
    "git",
    ["-c", "color.ui=false", "-c", "core.quotepath=false", ...args],
    {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function gitPath(repository, name) {
  return resolve(repository, git(repository, ["rev-parse", "--git-path", name]));
}

function unmergedPaths(repository) {
  return new Set(
    git(repository, ["ls-files", "--unmerged", "-z"])
      .split("\0")
      .filter((field) => field.length > 0)
      .map((field) => field.slice(field.indexOf("\t") + 1)),
  );
}

const client = new GitClient();

for (const fixture of fixtures) {
  assert.ok(existsSync(fixture.repository));
  if (fixture.marker === undefined) {
    assert.equal(existsSync(gitPath(fixture.repository, "CHERRY_PICK_HEAD")), false);
    assert.equal(existsSync(gitPath(fixture.repository, "REVERT_HEAD")), false);
    assert.match(git(fixture.repository, ["stash", "list"]), /conflicting stash/);
  } else {
    assert.ok(existsSync(gitPath(fixture.repository, fixture.marker)));
  }
  assert.deepEqual([...unmergedPaths(fixture.repository)], [fixture.path]);
  assert.match(
    readFileSync(resolve(fixture.repository, fixture.path), "utf8"),
    /^<<<<<<< /m,
  );

  const history = await client.loadHistory(fixture.repository);
  const state = await client.workingTreeChanges(
    fixture.repository,
    history.repository.head,
  );
  assert.equal(state.operation, fixture.operation);
  assert.deepEqual(
    state.files.map((file) => [file.path, file.conflict?.status]),
    [[fixture.path, "UU"]],
  );
  console.log(
    `Validated ${fixture.operation ?? "stash-apply"} conflict repository: ${fixture.repository}`,
  );
}

console.log("All operation fixtures expose one content conflict in Merge Changes.");
