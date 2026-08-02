#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

if (process.argv[2] === undefined) {
  throw new Error(
    "Usage: node scripts/create-demo-repository.mjs /absolute/path/to/git-amida-demo",
  );
}

const target = resolve(process.argv[2]);
const component = `${target}-component`;
const reviewWorktree = `${target}-review`;
const ownedPaths = [target, component, reviewWorktree];

for (const path of ownedPaths) {
  if (existsSync(path)) {
    throw new Error(
      `Refusing to overwrite existing path: ${path}\n` +
        "Move or remove it explicitly, then run the generator again.",
    );
  }
}

const identity = {
  name: "GitAmida Demo",
  email: "demo@git-amida.invalid",
};

function git(repository, args, options = {}) {
  const date = options.date;
  const authorDate = options.authorDate ?? date;
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
        ...(authorDate === undefined ? {} : { GIT_AUTHOR_DATE: authorDate }),
        ...(date === undefined ? {} : { GIT_COMMITTER_DATE: date }),
      },
      stdio: options.capture === false ? "inherit" : ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

function initialize(repository) {
  mkdirSync(repository, { recursive: true });
  git(repository, ["init", "-q", "-b", "main"]);
  git(repository, ["config", "user.name", identity.name]);
  git(repository, ["config", "user.email", identity.email]);
  git(repository, ["config", "commit.gpgsign", "false"]);
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

function remove(repository, path) {
  unlinkSync(pathIn(repository, path));
}

function rename(repository, before, after) {
  const afterPath = pathIn(repository, after);
  mkdirSync(dirname(afterPath), { recursive: true });
  renameSync(pathIn(repository, before), afterPath);
}

function commit(repository, subject, date, authorDate = date) {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "-q", "-m", subject], { date, authorDate });
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
  if (startPoint !== undefined) {
    args.push("-c", branch, startPoint);
  } else {
    args.push(branch);
  }
  git(repository, args);
}

function sceneSvg({ accent, secondary, title, subtitle, offset }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#101827"/>
      <stop offset="1" stop-color="#1d2940"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset="1" stop-color="${secondary}"/>
    </linearGradient>
  </defs>
  <rect width="960" height="540" rx="28" fill="url(#background)"/>
  <circle cx="820" cy="90" r="145" fill="${accent}" opacity=".10"/>
  <circle cx="130" cy="480" r="180" fill="${secondary}" opacity=".10"/>
  <text x="72" y="94" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="38" font-weight="700">${title}</text>
  <text x="72" y="132" fill="#a7b3c7" font-family="system-ui, sans-serif" font-size="18">${subtitle}</text>
  <g transform="translate(${offset} 0)">
    <rect x="72" y="184" width="248" height="276" rx="22" fill="#f8fafc" opacity=".96"/>
    <rect x="92" y="204" width="208" height="142" rx="16" fill="url(#accent)"/>
    <rect x="92" y="370" width="126" height="14" rx="7" fill="#26334a"/>
    <rect x="92" y="398" width="176" height="10" rx="5" fill="#8793a8"/>
    <rect x="92" y="420" width="142" height="10" rx="5" fill="#b3bccb"/>
    <rect x="356" y="184" width="248" height="276" rx="22" fill="#f8fafc" opacity=".92"/>
    <circle cx="480" cy="275" r="72" fill="url(#accent)"/>
    <rect x="376" y="370" width="148" height="14" rx="7" fill="#26334a"/>
    <rect x="376" y="398" width="192" height="10" rx="5" fill="#8793a8"/>
    <rect x="376" y="420" width="126" height="10" rx="5" fill="#b3bccb"/>
    <rect x="640" y="184" width="248" height="276" rx="22" fill="#f8fafc" opacity=".88"/>
    <path d="M680 326 732 242l54 58 38-42 34 68Z" fill="url(#accent)"/>
    <rect x="660" y="370" width="116" height="14" rx="7" fill="#26334a"/>
    <rect x="660" y="398" width="184" height="10" rx="5" fill="#8793a8"/>
    <rect x="660" y="420" width="154" height="10" rx="5" fill="#b3bccb"/>
  </g>
</svg>
`;
}

function bitmap(width, height, variant) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const output = Buffer.alloc(54 + pixelSize);
  output.write("BM", 0, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelSize, 34);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const position = 54 + y * rowSize + x * 3;
      const horizontal = Math.round((x / Math.max(1, width - 1)) * 255);
      const vertical = Math.round((y / Math.max(1, height - 1)) * 255);
      const card =
        x > width * 0.16 &&
        x < width * 0.84 &&
        y > height * 0.18 &&
        y < height * 0.78;
      output[position] = card ? (horizontal + variant * 31) % 256 : 30;
      output[position + 1] = card ? (vertical + variant * 47) % 256 : 24;
      output[position + 2] = card ? 210 - variant * 18 : 18;
    }
  }
  return output;
}

function readme() {
  return `# Aurora Gallery

Aurora Gallery is a fictional project generated for GitAmida validation and product screenshots. It contains no production data, credentials, third-party assets, or copied application code.

The repository deliberately combines readable product-like commits with Git edge cases:

- feature branches and non-fast-forward merges
- local, remote-tracking, and tag refs
- file additions, edits, rename chains, and deletions
- supported image changes and unsupported binary content
- paths with spaces and non-ASCII characters
- an intentionally oversized text blob on a test branch
- a local submodule and a branch occupied by another worktree
- more than 100 commits reachable through a long-history branch

## Screenshot candidates

Open this repository in Cursor or VS Code and use GitAmida in the bottom Panel.

1. Select **feat: publish seasonal collection** for a polished Changed files view containing image, rename, edit, and addition statuses.
2. Select the interval from **chore: add sample widget submodule** through **chore: remove legacy gallery assets** to demonstrate a continuous three-commit comparison without date-interleaved branch rows.
3. Combine **feat: improve gallery accessibility** with a main-branch commit to demonstrate explicit Selection behavior across branches.
4. Open File History for \`assets/gallery.svg\` and \`src/styles/palette.css\` to show image and rename history in separate tabs.
5. Use Tree mode when capturing the Changed files area so file and folder icons are both visible.

The latest main commit is intentionally newer than the unmerged branches, keeping local HEAD near the top of the default commit-date view. The synthetic \`origin/main\` ref is one commit behind to make local and remote orientation visible without network access.
`;
}

function validationGuide() {
  return `# GitAmida validation guide

The repository starts clean on \`main\`. Associated fixtures are siblings:

- \`${basename(component)}\`: source repository for the local submodule
- \`${basename(reviewWorktree)}\`: linked worktree holding \`release/preview\`

## Read-only navigation

- Follow graph lanes through both merge commits and each unmerged branch.
- Compare author and committer dates on **fix: refresh stale previews**.
- Inspect Added, Modified, Deleted, Renamed, image, binary, oversized, and submodule rows.
- Open several same-named \`config.ts\` files in File History and confirm tab disambiguation.
- Follow \`src/theme.css\` → \`src/styles/theme.css\` → \`src/styles/palette.css\` in File History.
- Exercise single, Range, and unrelated Selection comparisons.
- For a continuous Range, Shift-select from **chore: add sample widget submodule** through **chore: remove legacy gallery assets**.
- For an explicit Selection across branches, combine **feat: improve gallery accessibility** with **feat: publish seasonal collection**.

## Mutating safety checks

Run only one state at a time and restore the repository afterward.

\`\`\`sh
# unstaged refusal
printf '\\nlocal edit\\n' >> README.md
git restore README.md

# staged refusal
printf '\\nstaged edit\\n' >> README.md
git add README.md
git restore --staged README.md
git restore README.md

# untracked refusal
touch local-note.txt
rm local-note.txt
\`\`\`

Selecting \`release/preview\` for branch switching must be refused because it is checked out in the linked worktree. Other clean local branches remain valid switch targets.

## Publication capture

- Use a clean working tree unless the screenshot specifically explains **Uncommitted changes**.
- Avoid including absolute paths, editor account UI, terminals, notifications, or unrelated extensions.
- Capture one Repository History overview, one multi-commit Changed files view, one File History view, and one native image comparison.
- Prefer a neutral dark theme first, then verify that the same screen remains legible in a light theme.
`;
}

initialize(component);
write(
  component,
  "widget.json",
  `${JSON.stringify(
    {
      name: "aurora-sample-widget",
      version: "1.0.0",
      description: "Local submodule fixture for GitAmida",
    },
    null,
    2,
  )}\n`,
);
write(component, "README.md", "# Aurora sample widget\n");
commit(component, "feat: add sample widget", "2026-06-25T10:00:00+09:00");

initialize(target);
write(target, ".gitignore", ".DS_Store\n");
write(target, "README.md", readme());
write(target, "VALIDATION.md", validationGuide());
write(
  target,
  "src/app.ts",
  `export const galleryTitle = "Aurora Gallery";\n\nexport function itemCount(items: readonly unknown[]): number {\n  return items.length;\n}\n`,
);
write(
  target,
  "src/theme.css",
  `:root {\n  color-scheme: dark;\n  --surface: #101827;\n  --accent: #7dd3fc;\n  --text: #f8fafc;\n}\n`,
);
write(target, "src/client/config.ts", `export const pageSize = 12;\n`);
write(target, "src/worker/config.ts", `export const cacheLimit = 24;\n`);
write(
  target,
  "docs/project-overview.md",
  "# Project overview\n\nAurora Gallery presents curated seasonal artwork.\n",
);
write(
  target,
  "docs/legacy-notes.md",
  "# Legacy notes\n\nThis document is removed in a later revision.\n",
);
write(
  target,
  "docs/日本語 ガイド.md",
  "# 日本語ガイド\n\nこのファイルは日本語と空白を含むパスの確認用です。\n",
);
write(
  target,
  "assets/gallery.svg",
  sceneSvg({
    accent: "#7dd3fc",
    secondary: "#a78bfa",
    title: "Aurora Gallery",
    subtitle: "A calm place for visual stories",
    offset: 0,
  }),
);
write(target, "assets/preview.bmp", bitmap(480, 270, 0));
write(
  target,
  "assets/retired-banner.svg",
  sceneSvg({
    accent: "#f59e0b",
    secondary: "#ef4444",
    title: "Archive Collection",
    subtitle: "Retired visual fixture",
    offset: 0,
  }),
);
write(target, "fixtures/archive.bin", Buffer.from([0, 17, 34, 51, 68, 85]));
write(target, "fixtures/link-target.txt", "symlink target\n");
symlinkSync("link-target.txt", pathIn(target, "fixtures/example-link.txt"));
const rootHash = commit(
  target,
  "chore: initialize aurora gallery",
  "2025-01-01T09:00:00+09:00",
);

write(
  target,
  "data/collection.json",
  `${JSON.stringify(
    [
      { id: "dawn", title: "Quiet Dawn", color: "sky" },
      { id: "forest", title: "Night Forest", color: "violet" },
      { id: "harbor", title: "Blue Harbor", color: "cyan" },
    ],
    null,
    2,
  )}\n`,
);
write(
  target,
  "src/search.ts",
  `export function filterTitles(titles: readonly string[], query: string): string[] {\n  const needle = query.trim().toLowerCase();\n  return titles.filter((title) => title.toLowerCase().includes(needle));\n}\n`,
);
const searchHash = commit(
  target,
  "feat: add searchable collection",
  "2026-07-02T09:30:00+09:00",
);
git(target, ["tag", "v0.1.0", searchHash]);

git(target, ["branch", "feature/visual-refresh", searchHash]);
write(
  target,
  "src/keyboard.ts",
  `export const galleryKeys = ["ArrowLeft", "ArrowRight", "Home", "End"] as const;\n`,
);
const keyboardHash = commit(
  target,
  "feat: add keyboard navigation",
  "2026-07-03T14:20:00+09:00",
);
append(
  target,
  "docs/日本語 ガイド.md",
  "\n矢印キーでコレクションを移動できます。\n",
);
commit(
  target,
  "docs: expand Japanese quickstart",
  "2026-07-04T11:15:00+09:00",
);

switchTo(target, "feature/visual-refresh");
write(
  target,
  "assets/gallery.svg",
  sceneSvg({
    accent: "#38bdf8",
    secondary: "#c084fc",
    title: "Aurora Gallery",
    subtitle: "Curated stories in a brighter space",
    offset: -6,
  }),
);
write(target, "assets/preview.bmp", bitmap(480, 270, 1));
append(target, "src/theme.css", "\n.gallery-card { border-radius: 18px; }\n");
commit(
  target,
  "feat: refresh gallery artwork",
  "2026-07-05T10:40:00+09:00",
  "2026-07-03T16:10:00+09:00",
);
rename(target, "src/theme.css", "src/styles/theme.css");
append(
  target,
  "src/styles/theme.css",
  ".gallery-grid { display: grid; gap: 24px; }\n",
);
commit(
  target,
  "refactor: move theme styles",
  "2026-07-06T09:05:00+09:00",
);
write(
  target,
  "src/card-layout.ts",
  `export function cardColumns(width: number): number {\n  if (width < 640) return 1;\n  if (width < 1024) return 2;\n  return 3;\n}\n`,
);
commit(
  target,
  "feat: add responsive card layout",
  "2026-07-07T13:45:00+09:00",
);

switchTo(target, "main");
const visualMergeHash = merge(
  target,
  "feature/visual-refresh",
  "merge: integrate visual refresh",
  "2026-07-08T10:00:00+09:00",
);
git(target, ["branch", "feature/offline-mode", visualMergeHash]);
write(
  target,
  "src/export.ts",
  `export function exportSummary(ids: readonly string[]): string {\n  return ids.join("\\n");\n}\n`,
);
commit(
  target,
  "feat: add export summary",
  "2026-07-09T15:30:00+09:00",
);

switchTo(target, "feature/offline-mode");
write(
  target,
  "src/offline.ts",
  `const cacheName = "aurora-gallery-v1";\n\nexport function cacheKey(path: string): string {\n  return \`${"${cacheName}:${path}"}\`;\n}\n`,
);
commit(
  target,
  "feat: cache gallery metadata",
  "2026-07-10T09:20:00+09:00",
);
append(
  target,
  "src/offline.ts",
  "\nexport const refreshWindowMinutes = 15;\n",
);
commit(
  target,
  "fix: refresh stale previews",
  "2026-07-12T16:00:00+09:00",
  "2026-07-10T12:25:00+09:00",
);

switchTo(target, "main");
const offlineMergeHash = merge(
  target,
  "feature/offline-mode",
  "merge: integrate offline mode",
  "2026-07-13T10:10:00+09:00",
);

const componentRelative = relative(target, component).split(sep).join("/");
git(target, [
  "-c",
  "protocol.file.allow=always",
  "submodule",
  "add",
  "-q",
  componentRelative,
  "vendor/sample-widget",
]);
commit(
  target,
  "chore: add sample widget submodule",
  "2026-07-14T09:40:00+09:00",
);
rename(target, "docs/project-overview.md", "docs/project-guide.md");
append(
  target,
  "docs/project-guide.md",
  "\nThe gallery now supports keyboard navigation and offline metadata.\n",
);
commit(
  target,
  "docs: rename project guide",
  "2026-07-15T11:20:00+09:00",
);
remove(target, "docs/legacy-notes.md");
remove(target, "assets/retired-banner.svg");
write(
  target,
  "fixtures/archive.bin",
  Buffer.from([0, 17, 34, 51, 68, 85, 102, 119, 136]),
);
const cleanupHash = commit(
  target,
  "chore: remove legacy gallery assets",
  "2026-07-16T13:10:00+09:00",
);

switchTo(target, "feature/accessibility", offlineMergeHash);
write(
  target,
  "src/accessibility.ts",
  `export function galleryLabel(title: string, position: number, total: number): string {\n  return \`${"${title}, ${position} of ${total}"}\`;\n}\n`,
);
append(
  target,
  "docs/日本語 ガイド.md",
  "\nスクリーンリーダー向けに現在位置を読み上げます。\n",
);
commit(
  target,
  "feat: improve gallery accessibility",
  "2026-07-18T10:25:00+09:00",
);

switchTo(target, "main");
rename(target, "src/styles/theme.css", "src/styles/palette.css");
append(
  target,
  "src/styles/palette.css",
  ":root { --seasonal-highlight: #f0abfc; }\n",
);
write(
  target,
  "assets/gallery.svg",
  sceneSvg({
    accent: "#22d3ee",
    secondary: "#f0abfc",
    title: "Aurora Gallery",
    subtitle: "Seasonal collection · Summer 2026",
    offset: 4,
  }),
);
write(target, "assets/preview.bmp", bitmap(480, 270, 2));
write(
  target,
  "data/collection.json",
  `${JSON.stringify(
    [
      { id: "dawn", title: "Quiet Dawn", color: "cyan" },
      { id: "forest", title: "Night Forest", color: "orchid" },
      { id: "harbor", title: "Blue Harbor", color: "aqua" },
      { id: "summer", title: "Summer Signal", color: "pink" },
    ],
    null,
    2,
  )}\n`,
);
write(
  target,
  "docs/releases/summer-2026.md",
  "# Summer 2026\n\nA brighter seasonal collection with updated artwork.\n",
);
append(target, "src/client/config.ts", "export const preloadPages = 2;\n");
append(target, "src/worker/config.ts", "export const retryLimit = 3;\n");
const latestMainHash = commit(
  target,
  "feat: publish seasonal collection",
  "2026-07-20T09:00:00+09:00",
);
git(target, ["tag", "v0.2.0", latestMainHash]);

switchTo(target, "experiment/compact-layout", visualMergeHash);
write(
  target,
  "src/compact-layout.ts",
  `export const compactGap = 8;\nexport const compactLabels = false;\n`,
);
commit(
  target,
  "feat: prototype compact navigation",
  "2026-07-11T14:35:00+09:00",
);

switchTo(target, "test/large-assets", keyboardHash);
write(
  target,
  "fixtures/oversized.txt",
  Buffer.alloc(52 * 1024 * 1024, "A"),
);
write(target, "assets/large-preview.bmp", bitmap(2300, 2300, 3));
commit(
  target,
  "test: add large comparison fixtures",
  "2026-07-10T18:30:00+09:00",
);

switchTo(target, "test/long-history", rootHash);
write(target, "fixtures/timeline.txt", "Synthetic history fixture\n");
for (let index = 1; index <= 110; index += 1) {
  append(target, "fixtures/timeline.txt", `${String(index).padStart(3, "0")}\n`);
  const date = new Date(Date.UTC(2025, 0, 1 + index, 0, 0, 0))
    .toISOString()
    .replace(".000Z", "+00:00");
  commit(
    target,
    `test: extend history fixture ${String(index).padStart(3, "0")}`,
    date,
  );
}

switchTo(target, "main");
git(target, ["remote", "add", "origin", "https://example.invalid/git-amida-demo.git"]);
git(target, ["update-ref", "refs/remotes/origin/main", cleanupHash]);
git(target, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
git(target, ["branch", "release/preview", cleanupHash]);
git(target, ["worktree", "add", "-q", reviewWorktree, "release/preview"]);

const commitCount = Number(git(target, ["rev-list", "--all", "--count"]));
const status = git(target, ["status", "--porcelain"]);
const worktrees = git(target, ["worktree", "list", "--porcelain"]);
const submoduleStatus = git(target, ["submodule", "status"]);
git(target, ["fsck", "--full"]);

if (commitCount < 120) {
  throw new Error(`Expected at least 120 reachable commits, found ${commitCount}.`);
}
if (status !== "") {
  throw new Error(`Generated main worktree is not clean:\n${status}`);
}
if (!worktrees.includes(reviewWorktree)) {
  throw new Error("Linked review worktree was not registered.");
}
if (!submoduleStatus.includes("vendor/sample-widget")) {
  throw new Error("Sample widget submodule was not registered.");
}

console.log(`Created GitAmida demo repository: ${target}`);
console.log(`Created submodule source: ${component}`);
console.log(`Created linked worktree: ${reviewWorktree}`);
console.log(`Reachable commits: ${commitCount}`);
console.log(`Current branch: ${git(target, ["branch", "--show-current"])}`);
