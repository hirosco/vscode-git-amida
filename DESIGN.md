# GitAmida Design

## Purpose

GitAmida helps people review several Git commits as one coherent unit of change. The immediate experiment is narrower: determine whether an editor-native history panel provides substantially better review ergonomics than a terminal UI.

The key interaction is keeping the commit history and changed-file context visible while detailed diffs open in the editor area.

## Current product hypothesis

Cursor and VS Code are the primary environments for this branch. GitAmida contributes a View Container to the bottom Panel, alongside Terminal, Problems, and Output.

This is an editor-native comparison MVP, not yet an irreversible product decision. The Go terminal prototype remains isolated on its own branch. Do not combine both frontends or create a shared cross-language core before hands-on comparison identifies which experience should survive.

Evaluate the two approaches using concrete interaction costs:

- How easy GitAmida is to discover and reopen
- Whether history remains useful while source files and diffs are inspected
- The number of actions from commit selection to a readable diff
- Mouse and keyboard comfort during repeated use
- Layout clarity at realistic Panel heights and widths
- Responsiveness on an everyday repository
- The real value lost by tying this implementation to Cursor and VS Code

## Primary layout

```text
┌──────────────────── Cursor / VS Code ────────────────────┐
│ Editor area                                               │
│ ┌────────────────────┬────────────────────┐               │
│ │ Parent revision    │ Selected revision  │ native diff   │
│ └────────────────────┴────────────────────┘               │
├──────────────────────────┬───────────────────────────────┤
│ GitAmida Panel           │                               │
│ Commit graph and history │ Changed files                 │
│ ● Fix header             │ M src/header.ts              │
│ ● Update navigation      │ A src/navigation.ts          │
├──────────────────────────┴───────────────────────────────┤
│ Problems  Output  Terminal  GitAmida                      │
└───────────────────────────────────────────────────────────┘
```

The Panel contains the graph/history and changed files side by side. Selecting a commit updates the file list. Double-clicking a file, or pressing Enter while it is focused, opens the built-in `vscode.diff` editor and leaves the Panel available.

When the View is moved to a narrow sidebar, the two lists stack vertically rather than overflowing.

## Technology choices

### TypeScript extension

Implement the product experiment as one TypeScript extension.

- Cursor and VS Code already provide the Extension Host runtime to installed extensions
- The View Container API makes GitAmida visible beside built-in Panel tools
- The editor's native diff supplies selection, scrolling, syntax highlighting, accessibility, and familiar mouse behavior
- A single frontend is faster to change while the interaction model is still being validated

Node.js is a development and build tool only. Do not add a requirement for extension users to install Node.js.

### Webview View in the Panel

Use a Webview View for this MVP because a commit topology graph plus two independently scrollable horizontal panes cannot be represented well by one native Tree View. This exception must remain narrow:

- Use VS Code theme tokens instead of imitating another product
- Keep all scripts and styles local
- Apply a restrictive Content Security Policy with a per-render nonce
- Render Git data through DOM text nodes, never HTML interpolation
- Validate every message at the Extension Host boundary
- Preserve complete keyboard access for mouse actions

If later usage shows that a simpler native Tree View is sufficient, prefer it over retaining custom Webview behavior.

### Native diff editor

Load the before and after Git blobs into read-only virtual documents through `TextDocumentContentProvider`, then invoke the built-in `vscode.diff` command.

For a single commit:

- Compare an ordinary commit with its first parent
- Compare a root commit with Git's empty tree
- Show the first-parent behavior explicitly before merge-parent selection is added

The current virtual-document path assumes text content. Binary and image diffs report that the MVP does not support them instead of sending invalid text to the editor.

### Git CLI

Invoke the locally installed Git CLI from the Extension Host instead of parsing `.git` directly.

- Run `execFile` with an argument array and never use a shell
- Disable color, pagers, and external diff behavior
- Use NUL-delimited output for changed paths
- Keep all commands read-only
- Limit initial history to 100 commits and command output to 16 MiB
- Time out commands after 15 seconds

Paths are passed as arguments, but Git's `ref:path` syntax is still required to read historical blobs. Commit hashes and changed paths used for diff opening must come from the Extension Host's current parsed state, not directly from Webview messages.

## Logical architecture

```text
Panel View Container
        │
        ▼
Webview View (rendering and input only)
        │ validated messages
        ▼
Extension Host orchestration
        ├── Git CLI adapter
        ├── Current commit/file state
        └── Virtual text content provider
                         │
                         ▼
                   vscode.diff
                   in editor area
```

The Webview does not execute Git or construct Git revisions. The Git adapter does not import VS Code APIs. Keep parsing independently testable and do not add packages until the implementation requires a real boundary.

## Multiple-commit semantics

These semantics remain the product goal after the single-commit interaction is validated.

### Contiguous range

Treat everything from immediately before the oldest selected commit through the newest selected commit as one change. Show deduplicated files and the final diff for the whole range.

### Non-contiguous selection

Do not create a virtual tree by cherry-picking selected commits. Aggregate changed files, show the relevant commits for each file, and present per-commit diffs in chronological order.

### Entire branch

Treat the range from the merge base with an explicit or inferred base branch through the target branch as one change. Always allow correction of an inferred base.

## Safety and independence

The initial release is read-only. It does not provide commit, merge, rebase, reset, checkout, branch switching, or other repository-mutating operations.

GitAmida may learn from the general workflow of existing IDEs, but it must derive its screen and interactions from its own requirements. Do not reproduce JetBrains wording, icons, colors, assets, screenshots, or source code, and do not imply affiliation.

## Conditions for choosing a long-term direction

Do not merge this branch or the terminal prototype into `main` merely because either implementation is complete. Choose after both can be exercised on the same real repository.

Prefer the editor-native direction if the persistent Panel and native diff materially reduce review friction and editor lock-in is acceptable in practice. Prefer the terminal direction if portability across Cursor, the Codex app, and standalone terminals proves more valuable than the editor-native interaction. Consider a different design only when both fail the central workflow for concrete, recurring reasons.
