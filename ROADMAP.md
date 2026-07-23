# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect selected file scope through explainable native diffs between real Git states.

The remaining checkpoints build on selection-scoped, endpoint-based comparison and contain only work still needed to validate and extend that baseline.

## 1. Installed-extension validation

- Verify that the GitAmida Panel restores after a full Cursor restart
- Verify single-commit, Range, and Selection native diffs from the installed extension
- Install the same VSIX in VS Code when its CLI or application is available and compare activation, Panel layout, and native diff behavior with Cursor

This checkpoint is complete when the installed extension retains its state in normal Cursor use and the same VSIX has no editor-specific regression in VS Code. Marketplace publication and automatic updates remain outside this checkpoint.

## 2. Daily-use commit graph validation

- Observe dense branch and merge histories during normal repository work
- Tune line thickness, node size, lane spacing, or graph-column width only when a concrete readability problem appears
- Verify all five SCM graph theme colors in light and high-contrast themes
- Confirm that commit subjects, the checked-out branch or detached hash, remote HEAD/main indicators, and dates remain aligned in narrow Panels
- Add a global Date/Topology ordering choice only if daily use demonstrates that topology ordering is worth the additional option; keep Date as the default

This checkpoint is complete when branch ancestry can be followed quickly during daily use without terminal color artifacts or excessive horizontal cost.

## 3. Visual multi-commit selection

- Make Shift selection include every visible commit row between the anchor and active row so the highlighted result matches ordinary contiguous-list selection
- Keep Range when the visible selection exactly represents one ancestor-related before/after comparison
- Automatically use explicit Selection when the visible interval contains divergent, unrelated, or date-interleaved commits instead of silently excluding them
- Keep Changed files, details, and native diffs consistent with the automatically chosen Range or Selection semantics without requiring users to understand the distinction before selecting
- Preserve Cmd/Ctrl+click and Space as individual inclusion toggles after the initial Shift selection
- Test linear history, merged side branches, unrelated branches, and date-ordered interleaving where visual order differs from ancestry

This checkpoint is complete when users can select what they see without learning Git ancestry rules, while every aggregate remains explainable as either a real Range or an explicit Selection.

## 4. Daily-use refresh and file-tree controls

- Reproduce external `commit`, `switch`, `fetch`, `pull`, and `push` operations performed through terminals, Git GUIs, other editors, or AI tools while GitAmida is visible, hidden, and newly focused
- Detect resulting repository-state changes rather than monitoring a particular terminal or command source
- Distinguish working-tree-only changes from HEAD, local-ref, and remote-tracking-ref changes so the smallest correct state refresh runs automatically
- Fix missed built-in Git events or visibility transitions without resetting commit selection, file selection, or scroll position
- Do not add a routine visible **Refresh** button because users may reasonably interpret it as Fetch or remote synchronization; keep local view reload available from the Command Palette and show inline Retry only after an actual refresh failure
- Replace Tree expand-all and collapse-all `+` / `−` labels with compact, theme-safe icons that have accessible labels and tooltips
- Place Tree expansion actions beside the **Path** column heading and keep header height and alignment stable when switching between Flat and Tree
- Verify the controls in narrow, light, dark, and high-contrast Panel layouts

This checkpoint is complete when normal external Git operations refresh without intervention, failed refreshes offer a clear retry without resembling remote synchronization, and Tree controls read as file-navigation actions rather than text-editing buttons.

## 5. File History investigations

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

## 6. Repository and history hardening

- Let users choose a repository in multi-root workspaces
- Make first-parent behavior visible for individual merge commits and allow another parent to be chosen
- Present detached HEAD, empty repositories, and non-Git folders as explicit states
- Cancel stale history and blob requests as selection changes
- Prefetch additional history automatically near the current end instead of stopping at 100 commits or requiring a **Load more** action
- Preserve the visible scroll position while pages append and show an explicit retry only after a loading failure
- Preserve lane and color continuity while history pages append
- Test behavior in both Cursor and VS Code

## 7. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Add a lightweight image before-and-after view only if the native editor cannot provide a useful comparison
- Open detailed image and text comparisons in Kaleidoscope through a separate opener boundary
- Explain unavailable tools and retain the native diff as the fallback

## 8. Performance and public distribution

- Add virtualization, operation-specific output limits, cancellation, and diagnostics
- Verify large repositories, worktrees, and long-lived file-history tabs
- Define supported editor versions and platforms
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
