#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/create-ai-parallel-repository.mjs /absolute/path/to/git-amida-ai-parallel-demo",
  );
}

const target = resolve(process.argv[2]);
const agentRoot = `${target}-agents`;
for (const path of [target, agentRoot]) {
  if (existsSync(path)) {
    throw new Error(
      `Refusing to overwrite existing path: ${path}\n` +
        "Move or remove it explicitly, then run the generator again.",
    );
  }
}

const identity = {
  name: "GitAmida AI Parallel Demo",
  email: "ai-parallel@git-amida.invalid",
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

function merge(repository, branch, subject, date) {
  git(repository, ["merge", "-q", "--no-ff", "-m", subject, branch], {
    date,
  });
  return git(repository, ["rev-parse", "HEAD"]);
}

function switchTo(repository, branch, startPoint) {
  const args = ["switch", "-q"];
  if (startPoint === undefined) {
    args.push(branch);
  } else {
    args.push("-c", branch, startPoint);
  }
  git(repository, args);
}

function utcDay(day) {
  return new Date(Date.UTC(2026, 0, day, 9, 0, 0)).toISOString();
}

function repositoryReadme() {
  return [
    "# GitAmida AI parallel demo",
    "",
    "This disposable repository models a plausible AI-assisted development session rather than a pathological maximum-lane graph. It contains synthetic commits only.",
    "",
    "The history includes:",
    "",
    "- four short completed tasks integrated with merge commits and then deleted as branches",
    "- six active branch-backed agent worktrees",
    "- two active detached agent worktrees",
    "- one to three focused commits in each active worktree",
    "- three main-branch coordination commits created while agent work continues",
    "",
    "Open this repository in Cursor or VS Code, then open GitAmida in the bottom Panel. The graph should spend most of its history at a few lanes and fan out near the top while the eight linked worktrees remain active. Use this fixture to judge whether GitAmida's bounded graph column remains readable for realistic parallel work before changing graph width or adding column controls.",
    "",
    `The linked worktrees are stored in the sibling \`${basename(agentRoot)}\` directory. The generator refuses to overwrite either generated location.`,
    "",
  ].join("\n");
}

function validationGuide() {
  return [
    "# GitAmida AI parallel validation",
    "",
    `The main repository starts clean on \`main\`. Eight clean linked worktrees remain active in the sibling \`${basename(agentRoot)}\` directory.`,
    "",
    "## Graph checks",
    "",
    "- Follow the four completed task branches through their merge commits in the older half of the history.",
    "- Follow the active work from a few lanes into the current fan-out near the top.",
    "- Confirm that the main first-parent backbone keeps a stable color.",
    "- Confirm that every active worktree tip has one overlapping-frame symbol.",
    "- Inspect the two detached tips and confirm that their short commit hashes replace branch labels.",
    "- Resize the Panel and the Repository History split while comparing the default graph width with the 24-lane stress repository.",
    "- Check subject, inline ref, and date truncation at narrow widths.",
    "",
    "## Expected active worktrees",
    "",
    "- `agent/search-index`",
    "- `agent/api-cache`",
    "- `agent/editor-copy`",
    "- `agent/accessibility`",
    "- `agent/file-icons`",
    "- `agent/ref-labels`",
    "- two detached agent worktrees",
    "",
  ].join("\n");
}

mkdirSync(target, { recursive: true });
git(target, ["init", "-q", "-b", "main"]);
git(target, ["config", "user.name", identity.name]);
git(target, ["config", "user.email", identity.email]);
git(target, ["config", "commit.gpgsign", "false"]);

write(target, ".gitignore", ".DS_Store\n");
write(target, "README.md", repositoryReadme());
write(target, "VALIDATION.md", validationGuide());
write(target, "src/platform.ts", "export const platform = 'git-amida-demo';\n");
commit(target, "chore: initialize parallel workspace", utcDay(1));

write(target, "src/history.ts", "export const historyPageSize = 100;\n");
commit(target, "feat: establish repository history model", utcDay(2));

write(target, "test/history.test.ts", "export const historyFixture = 'ready';\n");
const sharedBase = commit(
  target,
  "test: cover baseline history loading",
  utcDay(3),
);

const completedTasks = [
  {
    branch: "completed/search-preview",
    path: "completed/search-preview.md",
    commits: [
      ["feat: prototype search preview", 4],
      ["test: cover search preview navigation", 7],
    ],
  },
  {
    branch: "completed/docs-index",
    path: "completed/docs-index.md",
    commits: [["docs: draft generated command index", 5]],
  },
  {
    branch: "completed/theme-tokens",
    path: "completed/theme-tokens.md",
    commits: [
      ["feat: prototype graph theme tokens", 6],
      ["test: cover high contrast graph colors", 9],
      ["fix: retain lane color at local head", 11],
    ],
  },
  {
    branch: "completed/history-tests",
    path: "completed/history-tests.md",
    commits: [
      ["test: add merge history fixture", 8],
      ["test: add paged history boundary", 10],
    ],
  },
];

for (const task of completedTasks) {
  switchTo(target, task.branch, sharedBase);
  for (const [subject, day] of task.commits) {
    append(target, task.path, `${subject}\n`);
    commit(target, subject, utcDay(day));
  }
  switchTo(target, "main");
}

write(
  target,
  "coordination/completed-wave.md",
  "Integrate the first reviewed agent tasks without retaining their branches.\n",
);
commit(target, "chore: prepare completed agent integrations", utcDay(12));
merge(
  target,
  "completed/search-preview",
  "merge: integrate search preview",
  utcDay(13),
);
append(
  target,
  "coordination/completed-wave.md",
  "Search preview review completed.\n",
);
commit(target, "docs: record first agent review outcome", utcDay(14));
merge(
  target,
  "completed/docs-index",
  "merge: integrate generated command index",
  utcDay(15),
);
merge(
  target,
  "completed/theme-tokens",
  "merge: integrate graph theme tokens",
  utcDay(16),
);
merge(
  target,
  "completed/history-tests",
  "merge: integrate parallel history tests",
  utcDay(17),
);
for (const task of completedTasks) {
  git(target, ["branch", "-D", task.branch]);
}

const activeWaveBase = git(target, ["rev-parse", "HEAD"]);
mkdirSync(agentRoot, { recursive: true });

const activeTasks = [
  {
    slug: "search-index",
    branch: "agent/search-index",
    startPoint: activeWaveBase,
    file: "agent-work/search-index.md",
    commits: [
      ["feat: draft incremental search index", 18],
      ["test: exercise incremental search index", 23],
      ["fix: preserve renamed search entries", 27],
    ],
  },
  {
    slug: "api-cache",
    branch: "agent/api-cache",
    startPoint: activeWaveBase,
    file: "agent-work/api-cache.md",
    commits: [
      ["feat: prototype history response cache", 19],
      ["test: invalidate cached history pages", 25],
    ],
  },
  {
    slug: "editor-copy",
    branch: "agent/editor-copy",
    startPoint: activeWaveBase,
    file: "agent-work/editor-copy.md",
    commits: [
      ["feat: draft editor copy action", 20],
      ["test: cover full hash copy action", 24],
      ["fix: keep copy action keyboard accessible", 28],
    ],
  },
];

function createAgentWorktree(task) {
  const worktree = resolve(agentRoot, task.slug);
  if (task.branch === undefined) {
    git(target, ["worktree", "add", "-q", "--detach", worktree, task.startPoint]);
  } else {
    git(target, [
      "worktree",
      "add",
      "-q",
      "-b",
      task.branch,
      worktree,
      task.startPoint,
    ]);
  }
  for (const [subject, day] of task.commits) {
    append(worktree, task.file, `${subject}\n`);
    commit(worktree, subject, utcDay(day));
  }
  return worktree;
}

const generatedWorktrees = activeTasks.map(createAgentWorktree);

write(
  target,
  "coordination/active-agents.md",
  "Wave one: search index, API cache, and editor copy.\n",
);
commit(target, "chore: checkpoint first active agent wave", utcDay(21));
const secondWaveBase = git(target, ["rev-parse", "HEAD"]);

const secondWaveTasks = [
  {
    slug: "accessibility",
    branch: "agent/accessibility",
    startPoint: secondWaveBase,
    file: "agent-work/accessibility.md",
    commits: [
      ["feat: draft graph accessibility labels", 22],
      ["test: cover graph keyboard focus", 29],
    ],
  },
  {
    slug: "file-icons",
    branch: "agent/file-icons",
    startPoint: secondWaveBase,
    file: "agent-work/file-icons.md",
    commits: [
      ["feat: draft content-kind icon mapping", 24],
      ["fix: retain icon contrast in dark themes", 30],
    ],
  },
  {
    slug: "ref-labels",
    branch: "agent/ref-labels",
    startPoint: secondWaveBase,
    file: "agent-work/ref-labels.md",
    commits: [["feat: simplify compact ref labels", 26]],
  },
];
generatedWorktrees.push(...secondWaveTasks.map(createAgentWorktree));

append(
  target,
  "coordination/active-agents.md",
  "Wave two: accessibility, file icons, and ref labels.\n",
);
commit(target, "chore: checkpoint second active agent wave", utcDay(27));
const detachedWaveBase = git(target, ["rev-parse", "HEAD"]);

const detachedTasks = [
  {
    slug: "detached-selection",
    startPoint: detachedWaveBase,
    file: "agent-work/detached-selection.md",
    commits: [
      ["feat: explore detached selection summary", 28],
      ["test: cover detached selection endpoints", 32],
    ],
  },
  {
    slug: "detached-refresh",
    startPoint: detachedWaveBase,
    file: "agent-work/detached-refresh.md",
    commits: [
      ["feat: explore detached refresh diagnostics", 29],
      ["fix: debounce detached worktree refresh", 33],
    ],
  },
];
generatedWorktrees.push(...detachedTasks.map(createAgentWorktree));

append(
  target,
  "coordination/active-agents.md",
  "Wave three: two detached investigations remain under review.\n",
);
const headHash = commit(
  target,
  "chore: coordinate eight active agent reviews",
  utcDay(34),
);

const branchCount = Number(
  git(target, ["for-each-ref", "--format=%(refname)", "refs/heads"])
    .split("\n")
    .filter((line) => line.length > 0).length,
);
const worktreeCount = git(target, ["worktree", "list", "--porcelain", "-z"])
  .split("\0")
  .filter((field) => field.startsWith("worktree ")).length;
const reachableCommitCount = Number(git(target, ["rev-list", "--all", "--count"]));
const currentBranch = git(target, ["branch", "--show-current"]);

if (branchCount !== 7) {
  throw new Error(`Expected 7 local branches, found ${branchCount}.`);
}
if (worktreeCount !== 9) {
  throw new Error(`Expected 9 registered worktrees, found ${worktreeCount}.`);
}
if (reachableCommitCount !== 37) {
  throw new Error(
    `Expected 37 reachable commits, found ${reachableCommitCount}.`,
  );
}
if (currentBranch !== "main") {
  throw new Error(`Expected current branch main, found ${currentBranch}.`);
}
for (const repository of [target, ...generatedWorktrees]) {
  const status = git(repository, ["status", "--porcelain"]);
  if (status !== "") {
    throw new Error(`Generated worktree is not clean: ${repository}\n${status}`);
  }
}
git(target, ["fsck", "--full"]);

console.log(`Created GitAmida AI parallel repository: ${target}`);
console.log(`Linked worktree directory: ${agentRoot}`);
console.log(`Visible commits including detached worktrees: 37`);
console.log(`Local branches: ${branchCount}`);
console.log(`Linked worktrees: ${worktreeCount - 1}`);
console.log(`Current branch: ${currentBranch}`);
console.log(`Current HEAD: ${headHash}`);
