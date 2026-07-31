# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect selected file scope through explainable native diffs between real Git states.

The remaining checkpoints build on selection-scoped, endpoint-based comparison and contain only work still needed to validate and extend that baseline.

## 1. Daily-use commit graph validation

- Observe dense branch and merge histories during normal repository work
- Tune line thickness, node size, lane spacing, or graph-column width only when a concrete readability problem appears
- Verify all five SCM graph theme colors in light and high-contrast themes
- Confirm that commit subjects, the checked-out branch or detached hash, remote HEAD/main indicators, and dates remain aligned in narrow Panels
- Add a global Date/Topology ordering choice only if daily use demonstrates that topology ordering is worth the additional option; keep Date as the default

This checkpoint is complete when branch ancestry can be followed quickly during daily use without terminal color artifacts or excessive horizontal cost.

## 2. Image comparison

- Investigate whether Cursor's native editor can present a useful before-and-after comparison for two historical image states
- Reuse the existing single-commit, Range, and Selection endpoint resolution instead of introducing image-specific comparison semantics
- Prefer the native editor when it can show both endpoints clearly; otherwise add only a lightweight GitAmida before-and-after view through a small dedicated image-opening boundary
- Label the actual before and after revisions and paths, including additions, deletions, and renames
- Preserve the current binary and oversized-content safeguards and avoid image editing, pixel analysis, overlay, or swipe controls
- Confirm basic compatibility in VS Code without making it the primary optimization target

This checkpoint is complete when an image selected from Changed files opens a useful comparison for single commits, Ranges, and Selections in Cursor without changing text-diff behavior. If a safe implementation requires a substantially larger custom viewer or storage design, defer it and continue with File History instead.

## 3. File History investigations

- Keep one pinned Repository History tab
- Open and close several independent File History tabs
- Reuse an existing tab when the same file is opened again
- Keep File History inside the GitAmida View rather than creating a separate Panel, so Repository History remains the stable center and file investigations share one navigation surface
- Design the internal tab strip before implementation: keep Repository History visible, keep the active File History tab discoverable, truncate long labels with full paths available, and provide an overflow list when tabs no longer fit
- Verify tab overflow, close behavior, keyboard traversal, and path disambiguation with narrow Panels and several files that share a basename
- Open file history from a changed file, the Explorer, and the active editor
- Follow renames and represent additions and deletions explicitly
- Preview a revision diff on selection and pin it on Enter or double-click
- Show a file revision in Repository History without closing its File History tab
- Load a repository commit that is outside the current history page
- Preserve selected revision and scroll position in every open File History tab

This checkpoint is complete when users can investigate several files and always return to their commits in the repository-wide graph.

## 4. Repository and history hardening

- Let users choose a repository in multi-root workspaces
- Make first-parent behavior visible for individual merge commits and allow another parent to be chosen
- Present detached HEAD, empty repositories, and non-Git folders as explicit states
- Cancel stale history and blob requests as selection changes
- Prefetch additional history automatically near the current end instead of stopping at 100 commits or requiring a **Load more** action
- Preserve the visible scroll position while pages append and show an explicit retry only after a loading failure
- Preserve lane and color continuity while history pages append
- Test behavior in both Cursor and VS Code

## 5. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Open detailed image and text comparisons in Kaleidoscope through a separate opener boundary
- Explain unavailable tools and retain the native diff as the fallback

## 6. Performance and public distribution

- Add virtualization, operation-specific output limits, cancellation, and diagnostics
- Verify large repositories, worktrees, and long-lived file-history tabs
- Define supported editor versions and platforms
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
