# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect selected file scope through explainable native diffs between real Git states.

The remaining checkpoints build on selection-scoped, endpoint-based comparison and contain only work still needed to validate and extend that baseline.

## 1. Daily-use commit graph validation

- Observe dense branch and merge histories during normal repository work
- Tune line thickness, node size, lane spacing, or graph-column width only when a concrete readability problem appears
- Verify all five SCM graph theme colors in light and high-contrast themes
- Confirm that commit subjects, the checked-out branch or detached hash, remote-default/main indicators, and dates remain aligned in narrow Panels
- Add a global Date/Topology ordering choice only if daily use demonstrates that topology ordering is worth the additional option; keep commit-date ordering as the default

This checkpoint is complete when branch ancestry can be followed quickly during daily use without terminal color artifacts or excessive horizontal cost.

## 2. Image comparison validation

- Validate native image comparisons for single commits, continuous ranges, explicit selections, and saved working-tree changes
- Confirm that additions, deletions, and renames communicate their actual empty or renamed endpoints clearly enough
- Confirm SVG visual comparison and the built-in JPG, JPE, JPEG, PNG, BMP, GIF, ICO, WebP, and AVIF formats in Cursor
- Confirm basic compatibility in VS Code without making it the primary optimization target
- Keep Git LFS object retrieval, image editing, pixel analysis, overlays, swipe controls, and an SVG source-diff switch outside this checkpoint unless validation demonstrates a concrete need

This checkpoint is complete when an image selected from Changed files opens a useful comparison for single commits, Ranges, Selections, and saved working-tree changes in Cursor without changing text-diff behavior.

## 3. File History investigations

- Verify the conditional Repository History home tab, filename-sized tabs, horizontal tab scrolling, integrated close actions, keyboard traversal, and path disambiguation with narrow Panels and several files that share a basename
- Validate renamed, added, and deleted file identities across several simultaneous tabs before treating the checkpoint as complete

This checkpoint is complete when users can investigate several files and always return to their commits in the repository-wide graph.

## 4. Repository and history hardening

- Let users choose a repository in multi-root workspaces
- Present detached HEAD, empty repositories, and non-Git folders as explicit states
- Cancel stale history and blob requests as selection changes
- Test behavior in both Cursor and VS Code

## 5. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Validate that the editor-title action where available and the Changed-files row context action open the same single-file text and image endpoints in the configured Git difftool for single commits, Ranges, Selections, and saved working-tree changes
- Confirm additions, deletions, renames, missing tool configuration, and launch failures retain an understandable native-diff fallback

## 6. Performance and public distribution

- Add virtualization, operation-specific output limits, cancellation, and diagnostics
- Verify large repositories, worktrees, and long-lived file-history tabs
- Regenerate the separate synthetic repository with `scripts/create-demo-repository.mjs`, then run end-to-end validation of its complex branches, merges, renames, deletions, binary and image files, long history, local submodule, and linked worktree in Cursor and VS Code before distribution
- Define supported editor versions and platforms
- Review product naming, trademarks, licensing, marketplace metadata, and privacy before publication

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
