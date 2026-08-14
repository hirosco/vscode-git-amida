# GitAmida Roadmap

GitAmida's current product target is:

> Keep Repository History as a compact navigation center, open several file investigations without losing it, and inspect selected file scope through explainable native diffs between real Git states.

The remaining checkpoints build on selection-scoped, endpoint-based comparison and contain only work still needed to validate and extend that baseline.

This roadmap reflects current priorities rather than release commitments and may change as validation and user feedback reveal better directions.

## 1. Changed-file working-tree access and copying

- Add **Open File in Working Tree** to the Changed-files row context menu and open only the exact current `file.path` beneath the active repository root
- Validate the requested row and path against current Extension Host state before opening it
- When the path does not exist or is not a regular file, show a concise notification that it may have been moved or deleted and direct the user to **Show File History**
- Do not search for same-named files, fall back to `oldPath`, or automatically resolve a later rename
- Add a compact **Copy** submenu with **File Name** and repository-relative **Relative Path** actions; use the after/current `file.path` for renamed rows
- Keep the existing click, double-click, and keyboard diff interactions unchanged instead of making Changed-files row text arbitrarily selectable

This checkpoint is complete when users can open an exact working-tree file or copy its stable name and repository-relative path from Changed files without guessing file identity or disrupting diff navigation.

## 2. Daily-use commit graph validation

- Inspect the separate AI parallel-worktree fixture in Cursor and VS Code to decide whether the bounded graph column remains adequate for a realistic short-lived fan-out from six branch-backed and two detached agent worktrees
- Generate the separate dense graph fixture with `scripts/create-graph-stress-repository.mjs`, validate it through the production Git adapter, and inspect the 4-, 8-, 12-, 16-, and 24-lane regions without adding pathological refs to the normal screenshot repository
- Observe dense branch and merge histories during normal repository work
- Tune line thickness, node size, lane spacing, or graph-column width only when a concrete readability problem appears
- Verify all five SCM graph theme colors in light and high-contrast themes
- Confirm that commit subjects, the checked-out branch or detached hash, remote-default/main indicators, and dates remain aligned in narrow Panels
- Add a global Date/Topology ordering choice only if daily use demonstrates that topology ordering is worth the additional option; keep commit-date ordering as the default

This checkpoint is complete when branch ancestry can be followed quickly during daily use without terminal color artifacts or excessive horizontal cost.

## 3. Image comparison validation

- Validate native image comparisons for single commits, continuous ranges, explicit selections, and saved working-tree changes
- Confirm that additions, deletions, and renames communicate their actual empty or renamed endpoints clearly enough
- Confirm SVG visual comparison and the built-in JPG, JPE, JPEG, PNG, BMP, GIF, ICO, WebP, and AVIF formats in Cursor
- Confirm basic compatibility in VS Code without making it the primary optimization target
- Keep Git LFS object retrieval, image editing, pixel analysis, overlays, swipe controls, and an SVG source-diff switch outside this checkpoint unless validation demonstrates a concrete need

This checkpoint is complete when an image selected from Changed files opens a useful comparison for single commits, Ranges, Selections, and saved working-tree changes in Cursor without changing text-diff behavior.

## 4. File History investigations

- Verify the conditional Repository History home tab, filename-sized tabs, horizontal tab scrolling, integrated close actions, keyboard traversal, and path disambiguation with narrow Panels and several files that share a basename
- Validate renamed, added, and deleted file identities across several simultaneous tabs before treating the checkpoint as complete

This checkpoint is complete when users can investigate several files and always return to their commits in the repository-wide graph.

## 5. Repository and history hardening

- Let users choose a repository in multi-root workspaces
- Verify that repeated preview navigation does not grow retained diff resources and that pinned diffs remain readable until closed
- Test behavior in both Cursor and VS Code

## 6. Diff controls and external tools

- Expose the editor's supported side-by-side and inline diff presentation
- Add explicit whitespace modes and context controls where the VS Code API can represent them reliably
- Validate that the editor-title action where available and the Changed-files row context action open the same single-file text, image, and binary endpoints in the configured Git difftool for single commits, Ranges, Selections, and saved working-tree changes
- Confirm additions, deletions, renames, unsupported binary formats, missing tool configuration, and launch failures retain an understandable native-diff fallback

## 7. Performance and public distribution

- Add history-row virtualization only if large-repository validation shows that cumulative DOM rendering remains a material cost after paging and request cancellation
- Verify large repositories, branch-backed and detached worktrees, and long-lived file-history tabs
- Regenerate the separate synthetic repository with `scripts/create-demo-repository.mjs`, then run end-to-end validation of its complex branches, merges, renames, deletions, binary and image files, long history, local submodule, branch-backed worktree, and detached agent worktree in Cursor and VS Code before distribution
- Confirm the README images and support links from the public repository, complete Open VSX namespace verification, and publish version `0.0.1` to both registries

Telemetry is not planned. Evaluate early versions through direct use and concrete reports of interaction problems.
