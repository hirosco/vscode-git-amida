# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect selected file scope through explainable native diffs between real Git states.

The remaining checkpoints build on selection-scoped, endpoint-based comparison and contain only work still needed to validate and extend that baseline.

## 1. Local extension installation

- Produce one reviewed VSIX that can be installed in both Cursor and VS Code
- Add a reproducible packaging command with pinned development tooling after dependency and lifecycle-script review
- Verify install, upgrade, activation, Panel persistence, and native diff opening outside the Extension Development Host
- Document the shortest local installation and update procedure for daily use
- Keep Marketplace publication and automatic update distribution out of this checkpoint

This checkpoint is complete when the multi-commit workflow can be evaluated in a normal daily-use editor window without launching a development host.

## 2. Daily-use commit graph validation

- Validate connected linear, branch, and merge lanes in real repositories
- Tune line thickness, node size, lane spacing, and graph-column width without reducing subject readability
- Verify all five SCM graph theme colors in primary, light, and high-contrast themes
- Keep commit subjects, refs, and dates aligned as the graph column changes width
- Confirm that selected and hovered rows retain visible commit nodes and lines
- Add a global Date/Topology ordering choice only if daily use demonstrates that topology ordering is worth the additional option; keep Date as the default

This checkpoint is complete when branch ancestry can be followed quickly during daily use without terminal color artifacts or excessive horizontal cost.

## 3. Safe branch switching

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

## 4. File History investigations

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

## 5. Single-commit and history hardening

- Let users choose a repository in multi-root workspaces
- Make first-parent behavior visible for individual merge commits and allow another parent to be chosen
- Handle renames, submodules, binary files, oversized blobs, detached HEAD, empty repositories, and non-Git folders explicitly
- Cancel stale history and blob requests as selection changes
- Prefetch additional history automatically near the current end instead of stopping at 100 commits or requiring a **Load more** action
- Preserve the visible scroll position while pages append and show an explicit retry only after a loading failure
- Preserve lane and color continuity while history pages append
- Test behavior in both Cursor and VS Code

## 6. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Add a lightweight image before-and-after view only if the native editor cannot provide a useful comparison
- Open detailed image and text comparisons in Kaleidoscope through a separate opener boundary
- Explain unavailable tools and retain the native diff as the fallback

## 7. Performance and public distribution

- Add virtualization, operation-specific output limits, cancellation, and diagnostics
- Verify large repositories, worktrees, and long-lived file-history tabs
- Define supported editor versions and platforms
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
