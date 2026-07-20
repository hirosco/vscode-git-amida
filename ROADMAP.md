# GitAmida Roadmap

GitAmida's current comparison target is:

> Keep Git history visible in Cursor while selecting a commit, inspecting its changed files, and opening a native side-by-side diff in the editor area.

## 1. Hands-on comparison checkpoint

Exercise this editor-native MVP and the Go terminal prototype on the same everyday repository.

- Confirm that GitAmida is visible and easy to reopen from the bottom Panel
- Review several ordinary and root commits
- Open several diffs while keeping the history context visible
- Resize the Panel horizontally and vertically
- Compare repeated mouse and keyboard use with the terminal prototype
- Record only concrete friction: extra actions, lost context, unreadable layouts, delays, and platform limitations
- Decide whether the editor-native approach, the terminal approach, or a reduced variant should become the next implementation baseline

This checkpoint is complete only after real use. Do not merge either branch into `main` before that decision.

## 2. Single-commit hardening

If the editor-native direction survives the comparison:

- Let users choose a repository in multi-root workspaces
- Group changed files in a navigable tree
- Make first-parent behavior visible for merge commits and allow another parent to be chosen
- Handle additions, modifications, deletions, renames, submodules, binary files, oversized blobs, detached HEAD, empty repositories, and non-Git folders explicitly
- Cancel stale history and blob requests as selection changes
- Test extension installation and behavior in both Cursor and VS Code

This checkpoint is complete when daily single-commit review is predictable and failures are explanatory rather than silent.

## 3. Multiple-commit MVP

- Distinguish single selection, a contiguous range, and non-contiguous selection
- Aggregate and deduplicate changed files
- Show commits relevant to each file
- Open the final diff for a contiguous range
- Open per-commit diffs chronologically for non-contiguous selection
- Preserve selection when diffs open and when the Panel is hidden and shown again

This is GitAmida's first distinctive product milestone. Keep only selection interactions that remain understandable in real use.

## 4. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Add a lightweight image before/after view only if the native editor cannot provide a useful comparison
- Open detailed image and text comparisons in Kaleidoscope through a separate opener boundary
- Explain unavailable tools and retain the native diff as the fallback

## 5. Performance, portability, and distribution

- Add history pagination, output limits by operation, cancellation, and diagnostics
- Verify large repositories and worktrees
- Package one VSIX for Cursor and VS Code
- Define supported editor versions and platforms
- Decide whether any editor-independent companion remains justified by measured use
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
