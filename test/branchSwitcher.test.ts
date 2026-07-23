import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

import {
  BranchMutationService,
  parseWorktreeBranches,
} from "../src/branchSwitcher";

interface RepositoryFixture {
  root: string;
  repository: string;
  targetHash: string;
  mainHash: string;
}

test("parseWorktreeBranches reads branch occupancy and detached worktrees", () => {
  const output = Buffer.from(
    "worktree /repo/main\x00" +
      "HEAD aaa\x00" +
      "branch refs/heads/main\x00\x00" +
      "worktree /repo/side path\x00" +
      "HEAD bbb\x00" +
      "branch refs/heads/feature/side\x00\x00" +
      "worktree /repo/detached\x00" +
      "HEAD ccc\x00" +
      "detached\x00\x00",
  );
  assert.deepEqual(parseWorktreeBranches(output), [
    { path: "/repo/main", branch: "main" },
    { path: "/repo/side path", branch: "feature/side" },
    { path: "/repo/detached" },
  ]);
});

test("BranchMutationService lists candidates and switches a clean worktree", async (context) => {
  const fixture = createFixture(context);
  const service = new BranchMutationService();

  assert.deepEqual(
    await service.localBranchesAtCommit(
      fixture.repository,
      fixture.targetHash,
    ),
    ["target"],
  );
  assert.deepEqual(
    await service.localBranchesAtCommit(fixture.repository, fixture.mainHash),
    [],
  );

  await service.switchBranch(
    fixture.repository,
    "target",
    fixture.targetHash,
    [],
  );
  assert.equal(currentBranch(fixture.repository), "target");
});

test("BranchMutationService rejects unsaved editor changes", async (context) => {
  const fixture = createFixture(context);
  const service = new BranchMutationService();

  await assert.rejects(
    service.switchBranch(
      fixture.repository,
      "target",
      fixture.targetHash,
      [join(fixture.repository, "tracked.txt")],
    ),
    /Save or close 1 modified editor/,
  );
  assert.equal(currentBranch(fixture.repository), "main");
});

for (const dirtyCase of [
  {
    name: "staged changes",
    prepare(fixture: RepositoryFixture): void {
      writeFileSync(join(fixture.repository, "tracked.txt"), "staged\n");
      git(fixture.repository, "add", "--", "tracked.txt");
    },
  },
  {
    name: "unstaged changes",
    prepare(fixture: RepositoryFixture): void {
      writeFileSync(join(fixture.repository, "tracked.txt"), "unstaged\n");
    },
  },
  {
    name: "untracked files",
    prepare(fixture: RepositoryFixture): void {
      writeFileSync(join(fixture.repository, "untracked.txt"), "new\n");
    },
  },
]) {
  test(`BranchMutationService rejects ${dirtyCase.name}`, async (context) => {
    const fixture = createFixture(context);
    dirtyCase.prepare(fixture);

    await assert.rejects(
      new BranchMutationService().switchBranch(
        fixture.repository,
        "target",
        fixture.targetHash,
        [],
      ),
      new RegExp(dirtyCase.name),
    );
    assert.equal(currentBranch(fixture.repository), "main");
  });
}

for (const operation of [
  { name: "merge", marker: "MERGE_HEAD", directory: false },
  { name: "rebase", marker: "rebase-merge", directory: true },
  { name: "cherry-pick", marker: "CHERRY_PICK_HEAD", directory: false },
  { name: "revert", marker: "REVERT_HEAD", directory: false },
  { name: "bisect", marker: "BISECT_START", directory: false },
  { name: "cherry-pick or revert sequence", marker: "sequencer", directory: true },
]) {
  test(`BranchMutationService rejects an in-progress ${operation.name}`, async (context) => {
    const fixture = createFixture(context);
    const marker = gitPath(fixture.repository, operation.marker);
    if (operation.directory) {
      mkdirSync(marker, { recursive: true });
    } else {
      writeFileSync(marker, `${fixture.targetHash}\n`);
    }

    await assert.rejects(
      new BranchMutationService().switchBranch(
        fixture.repository,
        "target",
        fixture.targetHash,
        [],
      ),
      new RegExp(operation.name),
    );
    assert.equal(currentBranch(fixture.repository), "main");
  });
}

test("BranchMutationService rejects a branch that moved after selection", async (context) => {
  const fixture = createFixture(context);
  git(fixture.repository, "branch", "-f", "target", fixture.mainHash);

  await assert.rejects(
    new BranchMutationService().switchBranch(
      fixture.repository,
      "target",
      fixture.targetHash,
      [],
    ),
    /no longer points at the selected commit/,
  );
  assert.equal(currentBranch(fixture.repository), "main");
});

test("BranchMutationService rejects a target branch used by another worktree", async (context) => {
  const fixture = createFixture(context);
  const worktreePath = join(fixture.root, "target worktree");
  git(
    fixture.repository,
    "worktree",
    "add",
    "-q",
    worktreePath,
    "target",
  );

  await assert.rejects(
    new BranchMutationService().switchBranch(
      fixture.repository,
      "target",
      fixture.targetHash,
      [],
    ),
    new RegExp(`already checked out.*${escapeRegExp(worktreePath)}`),
  );
  assert.equal(currentBranch(fixture.repository), "main");
});

function createFixture(context: TestContext): RepositoryFixture {
  const root = mkdtempSync(join(tmpdir(), "git-amida-branch-switch-test-"));
  const repository = join(root, "repository");
  mkdirSync(repository);
  context.after(() => rmSync(root, { recursive: true, force: true }));
  git(repository, "init", "-q");
  git(repository, "config", "user.name", "GitAmida Test");
  git(repository, "config", "user.email", "test@example.invalid");
  git(repository, "symbolic-ref", "HEAD", "refs/heads/main");

  writeFileSync(join(repository, "tracked.txt"), "base\n");
  git(repository, "add", "--", "tracked.txt");
  git(repository, "commit", "-q", "-m", "base");
  const targetHash = git(repository, "rev-parse", "HEAD").trim();
  git(repository, "branch", "target", targetHash);

  writeFileSync(join(repository, "tracked.txt"), "main\n");
  git(repository, "commit", "-q", "-am", "main progress");
  const mainHash = git(repository, "rev-parse", "HEAD").trim();
  return { root, repository, targetHash, mainHash };
}

function currentBranch(repository: string): string {
  return git(repository, "symbolic-ref", "--short", "HEAD").trim();
}

function gitPath(repository: string, name: string): string {
  const value = git(repository, "rev-parse", "--git-path", name).trim();
  return isAbsolute(value) ? value : resolve(repository, value);
}

function git(repository: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
