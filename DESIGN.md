# GitAmida Design

## Purpose

GitAmida's core value is helping people review multiple commits quickly as one unit of change.

When a history viewer occupies the editor area, users cannot see the Git log context and working files at the same time. GitAmida keeps history and changed files visible in the terminal and opens detailed diffs only where they are needed.

## Evidence-driven minimalism

GitAmida follows the principle “Small core, proven features.”

Start with the smallest implementation that solves the central problem instead of accumulating features based on predictions. Retain features only after real use demonstrates improvements in interaction cost, comprehensibility, or reliability. Place additions behind boundaries that do not complicate the core experience and allow safe removal when they do not prove useful.

## Preferred environments

The terminal TUI is the canonical interface. The same binary and interaction model should work whether it is launched from Cursor, VS Code, the Codex app, Ghostty, or another terminal.

VS Code and Cursor receive only a thin extension that launches the TUI from the status bar or command palette. A native panel is not planned. Registering a view container is small by itself, but implementing the commit graph, selection, and file tree would create a second frontend and duplicate core behavior.

## Primary layout

```text
┌──────────────────────────────────────────────────────────┐
│ Repository / Branch / Base / Diff mode / Whitespace      │
├──────────────────────────────┬───────────────────────────┤
│ Commit graph and history     │ Selected changes          │
│                              │                           │
│ ● Fix header                 │ 3 commits selected        │
│ │                            │                           │
│ ● Update navigation          │ ▼ src                     │
│ ├─● Feature work             │   header.scss       M     │
│ │ │                          │   nav.js            M     │
│ ●─┘ Merge                    │ ▼ templates               │
│                              │   nav.njk           A     │
├──────────────────────────────┴───────────────────────────┤
│ Internal diff / file preview                              │
└──────────────────────────────────────────────────────────┘
```

Place the commit graph on the left, the selection summary and changed-file tree on the right, and the internal diff below them. The internal diff can be hidden or expanded. Opening an external diff must preserve the history selection.

## Technology choices

### Go and Bubble Tea v2

Use Go, Bubble Tea v2, Bubbles v2, and Lip Gloss v2 for the TUI core.

Reasons:

- Easy distribution as a single binary
- No dependency on an editor or a Node.js runtime
- Support for keyboard input, mouse input, terminal resizing, and asynchronous work
- A consistent state-transition model through `Model / Update / View`
- Rust's performance advantage is not decisive for a tool that invokes and parses the Git CLI
- Lower implementation and maintenance overhead than Rust and Ratatui for this project

Do not adopt Rust. Image diffs use a lightweight preview plus external-tool integration rather than a sophisticated image TUI, so Ratatui's image widgets do not justify changing languages.

### VS Code/Cursor launch extension

Implement the editor extension in TypeScript, but limit it to these responsibilities:

- Show `GitAmida` on the left side of the status bar when a Git repository is open
- Launch a dedicated terminal from the status bar item or the `GitAmida: Open` command
- Reveal an existing GitAmida terminal instead of creating a duplicate
- Pass the current workspace, or a workspace folder selected by the user, through `--repo`
- Explain how to install GitAmida when the `git-amida` executable is unavailable

The extension does not run Git commands or own commit, selection, or diff state. Keeping it free of product behavior confines the TypeScript portion to an explicit platform adapter and avoids duplicating the Go core.

### Git CLI

The initial implementation invokes the locally installed Git CLI instead of reading Git objects directly.

- Reuse Git's own revision, rename, and diff semantics
- Avoid additional native libraries in an environment where Git is already available
- Keep implementation scope small until direct object access becomes necessary

Request stable, machine-readable output and disable user-controlled color, pagers, and external diffs.

## Logical architecture

```text
Terminal / editor launcher
        │
        ▼
CLI arguments / config
        │
        ▼
Application services
        │
        ├── Domain selection and aggregation
        │
        ├── Git CLI adapter
        │
        ├── Diff model
        │
        └── Diff opener registry
                  ├── Internal TUI
                  ├── VS Code CLI
                  ├── Kaleidoscope ksdiff
                  └── User-configured command
        │
        ▼
Bubble Tea TUI
```

The domain layer must not accept Bubble Tea or Git CLI types. This keeps selection logic independently testable and reusable if another frontend is ever justified.

## Commit-selection semantics

### Single commit

Compare the selected commit with its parent. Compare a root commit with Git's empty tree. Determine the default parent for merge commits during the initial spike, while leaving room for explicit parent selection.

### Contiguous range

When the selected commits are contiguous along one ancestry path, treat everything from immediately before the oldest commit through the newest commit as one change.

Show the commits in the range, deduplicated changed files, the final diff for the whole range, and each file's final state.

### Non-contiguous selection

Do not generate a virtual tree by cherry-picking the selected commits.

Aggregate and deduplicate changed files, show the relevant commits for each file, and present per-commit diffs in chronological order.

### Entire branch

Treat the range from the merge base with a base branch through the target branch as one change. When the base branch is inferred, provide an explicit way to correct a wrong guess.

## Diffs

### Text

Generate these presentation modes from the same diff model:

- Unified
- Side-by-side
- Word diff

Degrade from side-by-side to unified when the terminal is too narrow. Users must also be able to select the presentation mode explicitly.

Offer these whitespace modes:

- Compare all whitespace
- Ignore trailing whitespace
- Ignore changes in the amount of whitespace
- Ignore all whitespace
- Ignore changes whose lines are all blank

Keep Git CLI diff arguments consistent with the state shown on screen, and make the active whitespace mode visible at all times.

### Images

The initial image diff shows lightweight before-and-after previews in supported terminals. Do not implement advanced zooming, overlays, or pixel-level comparison.

Delegate detailed comparison to Kaleidoscope through `ksdiff`. When terminal support or image-library compatibility is insufficient, show metadata and an action for opening an external tool instead.

## Input

The keyboard is a complete interaction method. Mouse actions are equivalent shortcuts.

- Click: Select a row or move focus
- Modified click or selection toggle: Select multiple items
- Range-selection action: Select a contiguous range
- Double-click: Open the default diff for a file
- Wheel: Scroll the focused pane
- Drag: Out of initial scope

Detect a double-click as two clicks on the same cell within a time threshold. Always provide Space, Enter, and range-selection keys because some terminals do not report modifiers or mouse details reliably.

## Diff openers

Delegate file-opening actions to openers that are independent of Git parsing and the TUI.

### Internal

The always-available default fallback. Show a text diff or image summary inside the terminal.

### VS Code

Materialize Git blobs as dedicated temporary files and compare them with the VS Code CLI's `--diff` option. If the CLI is unavailable, explain the error and allow the user to return to the internal diff.

### Cursor

Before implementation, verify whether Cursor's editor CLI can reliably launch the equivalent diff. Do not depend on unverified CLI arguments.

### Kaleidoscope

Pass the before and after files to `ksdiff`. Recommend it for detailed image comparison, but never make it a required dependency.

### Custom

In the future, allow users to configure an executable and argument template. Validate and execute an argument array rather than evaluating a shell command string.

Place temporary files in a dedicated directory and do not delete them before the external tool has finished reading them. Make the revision and path identifiable from filenames and display labels.

## Performance

- Initially load a limited number of commits around the current branch
- Load additional history during scrolling
- Load changed files and diffs lazily after selection
- Run historical file exploration only when that feature is opened
- Detect oversized diffs, binary files, and submodules before automatic expansion
- Make long-running operations cancellable
- Do not store custom caches inside `.git` or the repository

## Safety

The initial release is read-only. It does not provide commit, merge, rebase, reset, checkout, or other repository-mutating operations.

Treat branch switching as a separate milestone if it is added. Define behavior for uncommitted changes, submodules, worktrees, and in-progress Git operations first.

Run external commands without a shell and pass arguments separately. Never treat Git output, paths, or commit messages as trusted shell fragments.

## Independent design

GitAmida may learn from the useful idea of reviewing multiple commits together, but it must not reproduce a specific product's UI.

- Derive screens and interactions from GitAmida's own requirements
- Use layout, wording, and key bindings appropriate for a TUI
- Do not import another product's code, icons, images, or screenshots
- Do not imply an affiliation through the product name or marketing

## Conditions for revisiting technology choices

Revisit the current architecture only when:

- An interaction that terminals cannot support becomes central to the product's value
- Image diffing becomes a core feature rather than a lightweight preview
- Measured Git CLI startup or parsing cost becomes a bottleneck

Until then, keep the Go TUI as the canonical interface and do not build a frontend in another language. Do not add a native panel merely in response to requests. Reconsider it only if recurring, concrete usage problems cannot be solved in the terminal.
