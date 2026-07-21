# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect every selected change in the native editor diff.

## 1. Commit graph validation

- Validate connected linear, branch, and merge lanes in real repositories
- Tune line thickness, node size, lane spacing, and graph-column width without reducing subject readability
- Verify all five SCM graph theme colors in primary, light, and high-contrast themes
- Keep commit subjects, refs, and dates aligned as the graph column changes width
- Confirm that selected and hovered rows retain visible commit nodes and lines

This checkpoint is complete when branch ancestry can be followed quickly without terminal color artifacts or excessive horizontal cost.

## 2. Safe branch switching

- Keep ref indicators display-only and add **Switch Branch…** to a commit row's native Webview context menu
- Open a Quick Pick containing every other local branch that points at the selected commit; hide or disable switching when no candidate exists
- Provide a keyboard-accessible command that opens the same Quick Pick for the selected commit
- Re-resolve branch candidates in the Extension Host immediately before switching
- Check dirty tracked files, untracked conflicts, in-progress operations, submodules, and worktree occupancy
- Explain blocked switches without stashing, discarding, forcing, or saving automatically
- Refresh all repository state after a successful switch
- Keep arbitrary commit switching out of the product and provide copyable commit IDs instead
- Do not create tracking branches from remote-tracking refs until local branch switching is reliable

This checkpoint is complete when switching behaves predictably in a clean repository and safely refuses every ambiguous state.

## 3. File History investigations

- Keep one pinned Repository History tab
- Open and close several independent File History tabs
- Reuse an existing tab when the same file is opened again
- Open file history from a changed file, the Explorer, and the active editor
- Follow renames and represent additions and deletions explicitly
- Preview a revision diff on selection and pin it on Enter or double-click
- Show a file revision in Repository History without closing its File History tab
- Load a repository commit that is outside the current history page
- Preserve selected revision and scroll position in every open File History tab

This checkpoint is complete when users can investigate several files and always return to their commits in the repository-wide graph.

## 4. Single-commit and history hardening

- Let users choose a repository in multi-root workspaces
- Make first-parent behavior visible for merge commits and allow another parent to be chosen
- Handle renames, submodules, binary files, oversized blobs, detached HEAD, empty repositories, and non-Git folders explicitly
- Cancel stale history and blob requests as selection changes
- Prefetch additional history automatically near the current end instead of stopping at 100 commits or requiring a **Load more** action
- Preserve the visible scroll position while pages append and show an explicit retry only after a loading failure
- Preserve lane and color continuity while history pages append
- Test installation and behavior in both Cursor and VS Code

## 5. Multiple-commit MVP

- Distinguish single selection, a contiguous range, and non-contiguous selection
- Aggregate and deduplicate changed files
- Show commits relevant to each file
- Open the final diff for a contiguous range
- Open per-commit diffs chronologically for non-contiguous selection
- Preserve selection when diffs open and when the Panel is hidden and shown again

This is GitAmida's first distinctive change-set review milestone. Keep only selection interactions that remain understandable in real use.

## 6. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Add a lightweight image before-and-after view only if the native editor cannot provide a useful comparison
- Open detailed image and text comparisons in Kaleidoscope through a separate opener boundary
- Explain unavailable tools and retain the native diff as the fallback

## 7. Performance and distribution

- Add virtualization, operation-specific output limits, cancellation, and diagnostics
- Verify large repositories, worktrees, and long-lived file-history tabs
- Package one VSIX for Cursor and VS Code
- Define supported editor versions and platforms
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
