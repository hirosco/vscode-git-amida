#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/create-conflict-demo-repository.mjs /absolute/path/to/vscode-git-amida-conflict-demo",
  );
}

const target = resolve(process.argv[2]);
const rebaseWorktree = `${target}-rebase`;

for (const path of [target, rebaseWorktree]) {
  if (existsSync(path)) {
    throw new Error(
      `Refusing to overwrite existing path: ${path}\n` +
        "Move or remove it explicitly, then run the generator again.",
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

function remove(repository, path) {
  unlinkSync(pathIn(repository, path));
}

function commit(repository, subject, date) {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "-q", "-m", subject], date);
  return git(repository, ["rev-parse", "HEAD"]);
}

function switchTo(repository, branch, startPoint) {
  git(repository, ["switch", "-q", "-c", branch, startPoint]);
}

function gitPath(repository, name) {
  const path = git(repository, ["rev-parse", "--git-path", name]);
  return resolve(repository, path);
}

mkdirSync(target, { recursive: true });
git(target, ["init", "-q", "-b", "main"]);
git(target, ["config", "user.name", identity.name]);
git(target, ["config", "user.email", identity.email]);
git(target, ["config", "commit.gpgsign", "false"]);
git(target, ["config", "core.autocrlf", "false"]);
git(target, ["config", "merge.conflictStyle", "diff3"]);
git(target, ["config", "rerere.enabled", "false"]);

write(
  target,
  "README.md",
  `# GitAmida conflict demo

This disposable repository is intentionally left with unresolved Git operations. It contains only synthetic content.

- \`${basename(target)}\`: a merge into \`main\` stopped at content and modify/delete conflicts
- \`${basename(rebaseWorktree)}\`: a linked worktree with \`rebase/topic\` stopped while rebasing onto \`rebase/base\`

Open each worktree as its own Cursor or VS Code workspace. Preserve these unresolved states while evaluating GitAmida; remove both generated paths and rerun the generator to reset them.
`,
);
write(
  target,
  "VALIDATION.md",
  `# Conflict validation guide

## Merge worktree

- Open \`${basename(target)}\` and confirm that Git reports an in-progress merge on \`main\`.
- Inspect \`src/merge-content.txt\`, which contains conflict markers and opens in the host editor's native conflict flow.
- Inspect \`src/merge-delete.txt\`, which is unresolved in the index while its saved file matches HEAD. Confirm that GitAmida still includes it under Merge Changes and directs an explicit open attempt to Source Control.

## Rebase worktree

- Open \`${basename(rebaseWorktree)}\` and confirm that Git reports an in-progress rebase with a detached HEAD.
- Inspect \`src/rebase-content.txt\`, which contains conflict markers.
- Confirm that GitAmida keeps repository history readable while showing the stopped rebase HEAD separately from the original \`rebase/topic\` ref.

Do not continue, abort, stage, or resolve either operation if the fixture needs to remain reusable. Regenerate it after any mutation.
`,
);
write(target, "src/merge-content.txt", "shared merge base\n");
write(target, "src/merge-delete.txt", "shared delete base\n");
write(target, "src/rebase-content.txt", "shared rebase base\n");
const sharedBase = commit(
  target,
  "chore: initialize conflict fixtures",
  "2026-08-01T09:00:00+09:00",
);

switchTo(target, "merge/incoming", sharedBase);
write(target, "src/merge-content.txt", "incoming branch content\n");
remove(target, "src/merge-delete.txt");
commit(
  target,
  "feat: prepare incoming merge changes",
  "2026-08-02T09:00:00+09:00",
);

git(target, ["switch", "-q", "main"]);
write(target, "src/merge-content.txt", "current main content\n");
write(target, "src/merge-delete.txt", "current main keeps this file\n");
commit(
  target,
  "feat: prepare current merge changes",
  "2026-08-03T09:00:00+09:00",
);

switchTo(target, "rebase/base", sharedBase);
write(target, "src/rebase-content.txt", "new rebase base content\n");
commit(
  target,
  "feat: update rebase base",
  "2026-08-04T09:00:00+09:00",
);

git(target, ["switch", "-q", "main"]);
git(target, [
  "worktree",
  "add",
  "-q",
  "-b",
  "rebase/topic",
  rebaseWorktree,
  sharedBase,
]);
write(rebaseWorktree, "src/rebase-content.txt", "topic commit content\n");
commit(
  rebaseWorktree,
  "feat: update rebase topic",
  "2026-08-05T09:00:00+09:00",
);

expectConflict(rebaseWorktree, ["rebase", "rebase/base"]);
expectConflict(target, ["merge", "--no-ff", "merge/incoming"]);

if (!existsSync(gitPath(target, "MERGE_HEAD"))) {
  throw new Error("Generated main worktree is not paused at a merge.");
}
if (
  !existsSync(gitPath(rebaseWorktree, "rebase-merge")) &&
  !existsSync(gitPath(rebaseWorktree, "rebase-apply"))
) {
  throw new Error("Generated linked worktree is not paused at a rebase.");
}
if (git(target, ["ls-files", "--unmerged"]) === "") {
  throw new Error("Generated main worktree has no unmerged index entries.");
}
if (git(rebaseWorktree, ["ls-files", "--unmerged"]) === "") {
  throw new Error("Generated rebase worktree has no unmerged index entries.");
}

git(target, ["fsck", "--full"]);

console.log(`Created GitAmida conflict repository: ${target}`);
console.log(`Merge state: ${git(target, ["branch", "--show-current"])}`);
console.log(`Rebase worktree: ${rebaseWorktree}`);
console.log(`Rebase HEAD: ${git(rebaseWorktree, ["rev-parse", "--short", "HEAD"])}`);
