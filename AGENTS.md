# AGENTS.md

## Project overview

GitAmida is a TypeScript extension for Cursor and VS Code focused on navigating Git history. Repository History is the singleton center; users can open several independent File History tabs and inspect changes in the editor's native diff.

Read `README.md`, `DESIGN.md`, and `ROADMAP.md` before implementation.

## Canonical documents

- `AGENTS.md`: Development procedures, conventions, and pitfalls
- `DESIGN.md`: Current architecture and reasons behind non-obvious decisions
- `ROADMAP.md`: Upcoming work and why it matters

Do not create append-only completion histories, ADR directories, or per-feature todo files. Update these documents to reflect the current truth and leave history to Git.

## Language policy

- Keep canonical repository documentation, code, identifiers, comments, and commit messages in English.
- Communicate progress, reviews, explanations, and handoffs to the project owner in Japanese unless requested otherwise.
- When changing English documentation, summarize the material changes and rationale in Japanese.
- Do not maintain complete translated copies of canonical documents.

## Implementation principles

- Prefer the smallest relevant change and avoid unrelated refactoring.
- Build the smallest interaction that can validate user value.
- Do not retain unused features merely because they were expensive to build.
- Keep the Webview limited to rendering and input; trusted repository and navigation state belong to the Extension Host.
- Keep the Git adapter independent of VS Code and Webview types.
- Provide an equivalent keyboard action for every mouse action.
- Reflow safely when the View is moved to a narrow container.
- Keep branch switching behind a separate mutation boundary from all history queries.
- Do not add history-editing operations without an explicit design change.

## Directory structure

```text
src/            Extension Host code, shared protocol, and Git adapter
webview/        Browser-targeted TypeScript for the Webview
media/          Local Webview CSS and extension icon
test/           Node tests for parsing and temporary repositories
.vscode/        Extension Development Host launch configuration
```

Do not introduce a framework, bundler, domain package, or nested extension workspace until a current feature requires it.

## Repository History UI

- Keep exactly one pinned, non-closable Repository History destination. Once a File History exists, represent Repository History with a compact home tab rather than a long text tab; hide the entire tab strip when no File History is open.
- Render each commit as one logical row with a non-wrapping subject line.
- Derive graph lanes from commit hashes and parents; do not send terminal graph text or ANSI color sequences to the Webview.
- Use the editor's `scmGraph.foreground1` through `scmGraph.foreground5` theme colors with safe workbench fallbacks.
- Show graph, subject, inline ref indicators, and date on one physical row. Truncate the subject and then excessive refs as space narrows.
- Show the authored timestamp in compact history rows and selected-commit lists, retain both timestamps in commit details, and keep the displayed timestamp independent from commit-date ordering.
- Mark local HEAD with a ring-and-center-dot graph node and label it with the checked-out branch, or the short commit hash when detached. Retain the remote icon-and-text `HEAD` indicator. Distinguish local, remote, and tag refs by fill and shape as well as color.
- Label local and remote-tracking `main` or `master` refs independently as orientation anchors, even at the same commit, and keep other branch names out of the compact row unless requirements change.
- Keep the primary branch's first-parent backbone on a stable graph color and let other tips retain a different color until they converge at a commit node.
- Keep complete ref names in commit details and accessible labels rather than hover-only UI.
- Keep author information in commit details instead of spending permanent history width.
- Preserve complete values through details, accessible labels, or tooltips when columns truncate or hide.
- Keep both the Repository History/inspection split and the changed-files/details split resizable.
- Keep Flat and Tree file presentation as explicit user-selectable modes.
- Put theme-safe Tree expand-all and collapse-all icons beside the Path column heading, with accessible labels and tooltips.
- Use bundled, theme-colored content-kind icons for files and folders in the Webview; do not parse or copy external File Icon Themes.
- Color changed-file paths with the same Git decoration token as their displayed status. Use the bundled icon to distinguish supported images without adding a redundant visible content label; keep labels for unsupported binary, oversized, and submodule content separate from Git status.
- Start Tree mode fully expanded after each file load and do not persist folder expansion state.
- Make the full commit hash easy to copy; do not provide arbitrary commit switching.
- Preserve selection and scroll state while File History tabs or native diffs are active in the current Extension Host session. After an editor restart or window reload, select the newest visible commit as one commit instead of restoring a prior commit, working-tree row, Range, or Selection.
- Let Shift select every visible commit row between a stable anchor and active row. Resolve the interval as Range only when it exactly matches one ancestor-related comparison; otherwise use Selection, while presenting a common selected-commit count as the primary state.
- Prefetch history automatically near the loaded end; do not use a routine **Load more** button. Offer retry only after a loading failure.
- Keep visual preferences global to the current editor profile. Keep Repository History navigation such as the selected commit and file transient to the current Extension Host session, and do not persist tree expansion.
- Keep commit ordering and other future behavioral options global rather than allowing workspace-specific overrides.
- Do not reserve Webview height for repository metadata in a single-root workspace. Add a compact repository chooser only when multi-root selection is implemented and multiple repositories are available.
- Show saved working-tree changes as one transient row above commits only while dirty. Keep it visually distinct, compare it with HEAD, and never include it in Range or Selection.
- Exclude unsaved editor buffers from the working-tree row until they are saved.
- Preserve commit selection and scroll while working-tree updates appear or disappear; return a selected working-tree row to HEAD when the repository becomes clean.
- Expose one theme-safe manual Refresh action in the native View title as recovery for missed external repository changes; do not add a second Refresh control inside the Webview.

## File History UI

- Permit several closable File History tabs while Repository History remains a singleton.
- Deduplicate tabs by repository identity and file identity.
- Preserve selected revision and scroll state per tab.
- Color each revision path and status with the matching Git decoration token, while keeping commit subjects and dates neutral.
- Show the selected revision's commit metadata in a resizable details column without duplicating Changed files.
- Keep File History tabs on one row, size them to their filename up to a readable maximum, scroll them horizontally when needed, and integrate each close action into its tab surface. Do not duplicate horizontal navigation with a separate tab-list selector.
- Keep open File History tabs and their navigation transient to the current Extension Host session; do not restore them after an editor restart or window reload.
- Open File History from changed files, Explorer resources, and editor resources.
- Keep branch labels out of File History until a concrete navigation problem demonstrates that they add value beyond Repository History.
- Let a revision reveal and select its commit in Repository History without closing the file tab.
- Single-click and keyboard navigation update a preview diff; Enter and double-click pin it.
- Handle renamed and deleted paths as identity transitions, not display-only labels.

## Node.js and dependency safety

- Use the Node.js and npm versions declared by `mise.toml` and `packageManager`.
- Use npm and commit `package-lock.json`.
- Use `npm ci` for clean and CI installs.
- Keep `.npmrc` supply-chain protections enabled.
- Prefer no runtime dependencies. Inspect source, lifecycle scripts, provenance, and the transitive graph before adding a dependency.
- Do not approve an install script broadly. Add an exact package version to `allowScripts` only after review.
- Do not run untrusted scripts with broad access to credentials, the home directory, synced storage, or external storage.
- Use `npm run package:inspect` to review the exact VSIX contents and `npm run package:vsix` to create the unsigned local evaluation package.
- Keep VSIX contents behind the `package.json#files` allowlist. Do not add a competing `.vscodeignore` strategy.
- Treat `--skip-license` as a local-only exception while the package is `UNLICENSED`; do not reuse that exception for public distribution.

## Git CLI handling

- Use `execFile` with an executable and argument array. Never construct a shell command.
- Put `--` before path arguments when the Git command accepts it.
- Disable color, pagers, and external diffs for parsed output.
- Use NUL-delimited path output.
- Preserve useful Git stderr and translate it into concise user-facing errors.
- Apply operation-specific history, output, and time limits.
- Do not depend on user aliases, pager, color, external diff, or path-quoting settings.
- Accept commit hashes and paths for follow-up operations only from parsed Extension Host state, never directly from untrusted Webview state.

## Branch switching safety

- Support named branch switching separately from read-only Git queries.
- Do not provide arbitrary commit switching or hide detached HEAD behind ordinary switch wording.
- Before switching, inspect staged, unstaged, untracked, and unsaved editor changes, in-progress Git operations, submodules, and worktree branch occupancy. Refuse any dirty current worktree even when Git could preserve its changes.
- Do not reject a repository merely because it uses worktrees. Reject only a target branch already checked out by another worktree and identify its path.
- Never stash, discard, force, or save editor contents automatically.
- If safety is uncertain, leave the repository unchanged and explain the blocker.
- Keep refusal handling inside a concise notification; do not redirect to Source Control unless product requirements change.
- Refresh all repository and history state after a successful switch.

## File revision restoration safety

- Keep single-file restoration behind a separate mutation boundary from history queries, native diffs, external difftools, and branch switching.
- Resolve the source ref, source path, and current row destination only from current Extension Host state; the Webview may identify only a currently loaded file row and endpoint side.
- Restore only an endpoint that contains a regular blob. Never interpret an absent endpoint as a deletion.
- Restore a renamed source into the current row path, write exact blob bytes, and leave the index unchanged.
- Before confirmation and again before replacement, reject unsaved editor content, staged or unstaged target changes, existing untracked or ignored targets, special or unresolved index entries, submodules, symbolic links, non-files, and paths outside the canonical repository root.
- Never stash, stage, discard, force, save editor contents, or overwrite uncertain state automatically.
- Refresh working-tree state after a successful restoration and keep the endpoint writer reusable by File History.

## Webview and editor integration

- Apply a restrictive Content Security Policy and use a new nonce for each HTML document.
- Load scripts, styles, and assets only from the extension package.
- Insert repository data with `textContent` or explicit DOM nodes; do not interpolate it into HTML or assign it to `innerHTML`.
- Validate Webview messages and ignore unknown fields and actions.
- Use VS Code theme tokens and accessibility semantics.
- Use `TextDocumentContentProvider` for read-only historical text, a dedicated read-only `FileSystemProvider` for supported image bytes, and `vscode.diff` for both comparison types.
- Use the same native preview model for Changed files and File History revisions: single-click and keyboard navigation reuse a preview diff; double-click and Enter pin it. Treat the explicit Changed-files **Open Changes** context action as a pinned open.
- Put the active-file File History action in the editor title and the manual Refresh action in the native GitAmida View title, using standard theme icons and keyboard-accessible commands.
- Expose an external Git difftool only through an explicit action on an active GitAmida native diff or one current Changed-files row. Use the native diff's registered endpoints when available; otherwise resolve only the context-clicked file against the currently loaded selection. Pass private endpoint copies through `git difftool --no-index` and do not add an aggregate Changed-files launch.
- Match the built-in image preview formats (`jpg`, `jpe`, `jpeg`, `png`, `bmp`, `gif`, `ico`, `webp`, `avif`, and `svg`) and keep other binary content and unsupported encodings explicit rather than coercing them into a diff.
- Use the current `diffEditor.maxFileSize` value for text comparison instead of imposing a narrower GitAmida-specific limit, and refresh content classification when that setting changes.
- Do not impose a GitAmida-specific image-size limit narrower than the native preview. Size the Git blob read for the actual object while retaining bounded output for other Git operations.
- Debounce built-in Git repository events. Refresh only working-tree state when HEAD and refs are stable, and reload history when their fingerprint changes.
- Recheck the repository history fingerprint when the retained View becomes visible so missed background events cannot leave stale history.
- Schedule working-tree refresh directly after file-document saves and continue debounced refreshes while the retained View is hidden.
- Keep manual refresh available from both the native View title and Command Palette, and keep inline retry limited to errors.

## Diff conventions

- Keep every aggregate explainable as a selected file scope plus visible endpoints that identify actual Git states.
- Compare a normal commit with its first parent.
- Compare a root commit with Git's empty tree.
- For a contiguous range, compare immediately before the oldest commit with the newest commit.
- For an explicit Selection, list only paths changed by selected commits. For each listed path, compare the state before its oldest selected change with the state after its newest selected change.
- Make Selection endpoints visible: intervening unselected changes to the same path are part of that endpoint diff, while files changed only by unselected commits remain absent.
- Do not construct a virtual tree or imply that changes from unrelated branches were merged. The newest selected endpoint supplies the after-state for a shared path.
- Treat whitespace choices as Git diff-generation inputs, not visual-only filters.

## Testing

- Test Git parsing with fixed byte sequences and temporary repositories.
- Never mutate the user's real repositories or global Git configuration in tests.
- Test root commits, merges, renames, deletions, binary files, and paths with spaces or non-ASCII characters as those behaviors are added.
- Test navigation state independently: Repository History singleton, File History tab deduplication, selection retention, and reveal-in-log.
- Test branch switching only in temporary repositories and cover every refusal state before success paths.
- Test file restoration only in temporary repositories. Cover exact binary bytes, rename destinations, missing-file recreation, index preservation, and every refusal state before success paths.
- Keep Webview logic small; test trusted state transitions in TypeScript rather than relying only on HTML snapshots.
- Run `npm ci`, `npm run check`, `npm test`, and `npm run package:inspect` at each checkpoint.
- Manually verify mouse, keyboard, resizing, focus, Panel persistence, and native diff opening in Cursor and VS Code.

## UI and intellectual-property considerations

- Abstract useful workflow ideas from existing history tools into GitAmida's own requirements.
- Do not faithfully reproduce a specific product's layout, wording, icons, colors, or imagery.
- Do not import JetBrains source code, assets, or screenshots without permission.
- Do not imply affiliation or official compatibility through naming or presentation.

## Git workflow

- Write commit messages in English and follow Conventional Commits.
- Use `feature/<topic>` for new branches by default.
- Use `git switch` to change branches and `git restore` to restore files.
- Preserve existing user changes and do not mix unrelated work into the task.
