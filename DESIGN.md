# GitAmida Design

## Purpose

GitAmida is a history-centered repository state navigator for understanding where a repository is now and how its files changed over time.

The central experience is Repository History: scan a compact commit graph, inspect changed files and commit details, and open native diffs without hiding the log. File histories branch from that center as independent investigation tabs and can link back to the relevant repository commit.

Reviewing selected commit changes through one explainable, file-oriented view remains a distinctive goal, but it belongs inside this broader history-navigation model rather than defining a separate tool.

The product should provide repository situational awareness in one stable landscape: current HEAD and branch, local and remote orientation, saved working-tree changes, commit relationships, selected change scope, and file-level evidence. VS Code and Cursor expose many of these capabilities across Source Control, the Status Bar, commands, editor diffs, and extensions; GitAmida avoids making users reconstruct the overall state by moving among those surfaces. It may add small navigation mutations such as safe named-branch switching when they follow naturally from the visible history, but it does not become a staging, commit, stash, conflict-resolution, or history-editing client.

## Product surface

Cursor and VS Code are the primary environments. GitAmida contributes one View Container to the bottom Panel, alongside Terminal, Problems, and Output.

The GitAmida view owns two kinds of internal tabs:

- **Repository History**: exactly one pinned, non-closable tab
- **File History**: zero or more closable tabs, one per repository path

Opening the same file history twice focuses its existing tab. File-history tabs preserve their selected revision and scroll position while another tab is active. Repository History preserves its selected commit and file state when a file-history tab is opened.

Detailed text and supported image comparisons open in the editor's native diff view instead of consuming the limited height of the bottom Panel. An explicit editor-title action can reopen that active GitAmida comparison in the user's configured Git difftool when the editor API identifies the tab reliably. Each current Changed-files row also exposes the same single-file action from its context menu because Cursor does not currently expose an active native image-diff tab through the stable Tab API.

Do not spend permanent Webview height on repository metadata that is already implied by a single-root workspace and repeated at HEAD. Use the editor-native View title for commands. When multi-root selection is implemented, add a compact repository chooser only when more than one repository is available.

## Repository History

### Commit list

The commit list is optimized for scanning a large history.

- Render every commit as one logical row with a compact primary line
- Never wrap the subject; place compact ref indicators after it on the same physical line
- Show graph, subject, and date in the history list; keep author information in commit details
- Order commits by commit date while ensuring that no parent appears before its children, and show the committed timestamp in the date column
- Give the subject flexible width and truncate it with an accessible full-value label
- Mark local HEAD with a ring around a visible center dot and label it with the checked-out local branch; show the short commit hash instead when HEAD is detached, and retain the remote icon-and-text `HEAD` indicator
- Label local and remote-tracking `main` or `master` refs as compact orientation anchors; when the local primary branch is checked out, use the current-branch label instead of rendering that local ref twice, while retaining an independent remote indicator at the same commit
- Use fill as well as color to distinguish refs: local branch indicators are filled, remote-tracking indicators are outlined, and tags use a distinct shape
- Prefer the subject when horizontal space is scarce, then truncate overflowing ref indicators with an ellipsis
- Keep complete ref names in commit details and accessible labels rather than hover-only UI
- Treat refs as branch or tag pointers whose current target is exactly that commit. Git does not record one owning branch for a commit; branches that contain it are a separate reachability query
- Keep graph alignment stable while refs appear or disappear
- Keep the selected row visually distinct without relying on color alone

The full commit hash and other secondary metadata do not need permanent space in every row.

### Working tree

When saved uncommitted changes exist, show one visually distinct **Uncommitted changes** row above the commits. It represents the working tree relative to the current HEAD, not a commit that GitAmida may include in a Range or Selection.

- Include staged and unstaged tracked changes in their combined saved working-tree state, plus untracked files
- Exclude unsaved editor buffers until they are saved to disk
- Show the row only while at least one changed path exists and include the changed-file count
- Use a dedicated graph marker without commit metadata or a fabricated timestamp
- Keep the checked-out branch label on the real HEAD commit
- Preserve the current commit selection and visible scroll position when the row appears or disappears
- If the working tree is selected when it becomes clean, return selection to HEAD
- Compare a tracked path from HEAD to its current saved filesystem content; compare untracked files from an empty before-state
- Keep the working tree out of Shift ranges and Cmd/Ctrl explicit commit selections

### Changed files and commit details

The right side is split vertically:

- Changed files above
- Selected commit details below

The divider is resizable. Commit details can be collapsed, but changed files must retain a usable minimum height.

Changed files support a flat full-path list and a user-controlled Tree mode for large changes. Flat is the default for fast scanning. Tree mode starts fully expanded whenever files are loaded and provides theme-safe expand-all and collapse-all icons beside the Path column heading. Their accessible labels and tooltips carry the complete action names, and the header keeps the same height when switching presentation modes. Expansion state is intentionally not persisted across commit changes, refreshes, or editor restarts.

Changed-file rows use compact bundled SVGs to distinguish ordinary files, supported images, binary or oversized content, submodules, and open or closed folders. Trusted content metadata selects the icon, including SVG files now handled by native image comparison. VS Code color-theme tokens supply each icon's color. These icons intentionally do not reproduce the active File Icon Theme because a Webview has no public API for resolving that theme's filename and language associations; parsing other extensions' theme assets would add unsupported coupling and licensing risk.

Color file paths with the same VS Code Git decoration token as their displayed status. A supported image uses its bundled icon and the same visible status wording as a normal diffable file; its accessible description still identifies it as an image. Keep explicit content-kind labels for binary, oversized text, and submodules because they explain why comparison is unavailable.

The vertical split between Repository History and inspection is resizable and shared across workspaces in the same editor profile. Its default gives inspection enough width for full commit metadata without sacrificing a usable history list; narrow containers may still reflow vertically.

Persistent borders are reserved for the structural boundaries between Repository History and inspection, and between changed files and commit details. Repeated rows, headings, status labels, and view switches rely on spacing, backgrounds, and focus states instead because themes may render `panel.border` with deliberately high contrast. Resizers keep a forgiving hit area while drawing only a one-pixel resting divider.

The details pane shows:

- Full commit subject
- Full selectable commit hash without a persistent copy button; provide copying through contextual actions
- Author name and email
- Authored or committed time, with the chosen meaning labeled
- Branch and tag refs pointing directly at the selected commit, shown one per line with the same local, remote, and tag indicators used in Repository History
- Parent commits
- The active comparison parent for a merge commit

Selecting a commit updates both changed files and details. Loading either area must not block or clear the other area unnecessarily.

Selecting **Uncommitted changes** keeps the stable details area but replaces commit metadata with the HEAD comparison basis, changed-file count, and an explicit note that unsaved editor buffers are excluded.

### Commit graph

The Extension Host derives a lane model from commit hashes and parents instead of accepting terminal graph text from Git. Each history row carries typed line segments and a commit node; the Webview renders them as a compact SVG aligned with the row. Lane transitions use unsmoothed straight segments so branches and merges remain visually discrete in the dense Panel layout. Lines meet ordinary filled nodes without a background gap; local HEAD connections stop at the outside of its ring instead of crossing the marker. Lines that share a parent remain separate until they converge at that parent's node, making the exact branch point visible instead of joining between commits. This prevents terminal ANSI sequences from leaking into the browser and keeps graph structure independent of user Git color configuration.

Lane colors use VS Code's `scmGraph.foreground1` through `scmGraph.foreground5` theme tokens with standard workbench fallbacks. When local or remote-tracking `main` or `master` exists, its first-parent backbone reserves the primary graph color. When matching local and remote refs differ only by progress, use the most advanced first-parent tip; prefer the local ref when candidates are not on one first-parent path. Other tips keep a different lane color until they meet that backbone, so progress away from the primary branch remains visible even while only one lane is active. The graph column grows in bounded steps as concurrent lanes increase, then compresses lane spacing rather than taking unbounded horizontal space from commit subjects. The current evaluation build lays out the complete loaded history in one pass; pagination must later preserve active lane and color state across loaded batches.

## File History

A file history is an investigation opened from one of these entry points:

- A changed-file context menu in Repository History
- The Cursor or VS Code Explorer context menu
- The active editor's title or context menu

Several file histories may stay open simultaneously. Repository History remains a singleton because it is the stable navigation center; supporting several repository logs would add repository ownership, cache, and selection complexity without a demonstrated need.

Each File History tab shows revisions that changed the file, follows renames where Git can determine them, and retains the path identity needed to compare historical blobs.

- Single-clicking a revision updates a preview diff
- Enter or double-click opens or pins the native diff
- **Show in Repository History** activates the singleton Repository History tab, loads the commit if necessary, and selects it
- Returning to Repository History never closes the originating File History tab

Path history must handle additions, deletions, renames, merge simplification, and commits outside the initially loaded repository-history page explicitly.

## Branch switching

GitAmida plans to support switching to a named branch. It does not provide direct switching to an arbitrary commit.

- Keep history ref indicators display-only; their small targets are not suitable branch-switch controls
- Open the editor-native Webview context menu from a Repository History commit row and expose **Switch Branch…** only when the commit has a switchable local branch
- Use Quick Pick to show every local branch pointing at that commit, excluding the already checked-out branch
- Provide the same Quick Pick from a keyboard-accessible command for the selected commit
- Resolve and validate branch candidates again in the Extension Host instead of trusting stale Webview state
- Use `git switch` with an argument array and no shell
- Check working-tree changes, untracked conflicts, in-progress Git operations, submodules, and worktree branch occupancy before switching
- Refuse switching whenever the current worktree has staged, unstaged, untracked, or unsaved editor changes, even if Git itself could preserve some of them
- Permit repositories that use worktrees; refuse only when another worktree already has the target branch checked out, and identify that worktree in the notification
- Never stash, discard, force, or save editor contents automatically
- Explain why switching is blocked in a notification and leave the repository unchanged; do not redirect to Source Control or add recovery actions in the initial implementation
- Refresh HEAD, branch, history, changed files, details, and relevant file histories after a successful switch
- Do not create a local tracking branch from a remote-tracking ref in the initial implementation

The commit hash remains copyable so an informed user can run `git switch --detach <hash>` manually. Do not label a detached-HEAD action as ordinary switching.

Branch switching changes the working tree but not Git history. Keep it behind a separate application boundary from all read-only history queries and test it independently.

## Native diff editor

Load before and after text blobs into read-only virtual documents through `TextDocumentContentProvider`, then invoke the built-in `vscode.diff` command. Route supported image bytes through a dedicated read-only `git-amida-image` `FileSystemProvider`; preserving the original filename extension lets the built-in image preview provide the native before-and-after editor without a GitAmida Webview or temporary files.

Match the built-in image preview selector exactly: JPG (`.jpg`, `.jpe`, and `.jpeg`), PNG, BMP, GIF, ICO, WebP, AVIF, and SVG. SVG uses visual comparison by default; a separate source-diff switch is outside the initial image checkpoint. HEIC and TIFF remain ordinary unsupported binary files because the built-in preview does not select them.

Double-click and Enter are explicit open actions. Open Repository History comparisons in the editor's preview tab so inspecting another changed file replaces the current comparison instead of accumulating one tab per file. Users may pin a comparison with the editor's normal tab interaction when they need to retain it.

For a single commit:

- Compare an ordinary commit with its first parent
- Compare a root commit with Git's empty tree
- Show the active parent for merge commits and later allow explicit parent selection

For the working tree, read the saved filesystem state through a repository-scoped path boundary and compare it with the corresponding HEAD blob. Capture the working-tree image bytes when opening the comparison so later saves do not silently change that endpoint. Do not use the editor buffer as the comparison endpoint because an unsaved document is not yet part of Git's working tree.

The virtual-document path follows the current VS Code or Cursor `diffEditor.maxFileSize` setting, whose editor default is 50 MB, instead of imposing a narrower GitAmida-specific text limit. Reclassify changed content when that setting changes, and check the actual endpoint sizes again before reading or decoding them. Image reads likewise obtain the actual Git object size and use that size for the one blob command instead of inheriting the normal 16 MiB Git-output buffer; GitAmida adds no deliberate product limit below the native preview. The editor runtime and available memory remain practical limits because its file-system API returns each image as a complete byte array. Cursor 3.13.25 was unstable when repeatedly loading two approximately 16 MiB custom-scheme BMP endpoints: three of eight full-window loads displayed both sides and five left one side in the native image-loading error state, but the failed sequence eventually recovered after further reloads. The built-in Git scheme also loaded large endpoints slowly. Treat this as native-preview instability for now: do not add an arbitrary lower limit or a temporary-file fallback, and retry by reopening or reloading when it occurs. Keep other binary blobs, submodules, and oversized text visible in Changed files, explain why native comparison is unavailable, and do not decode unsupported content as UTF-8. Git LFS object retrieval remains a later concern.

Each native diff is registered with its repository, before and after paths, and both opaque editor URIs when it opens. The editor-title external-tool action reads those exact displayed endpoints instead of consulting the current Repository History selection again, so later navigation cannot change the meaning of an already open Range or Selection diff. Cursor's stable Tab API can report no active tab for a native image diff, so each Changed-files row also provides a context-menu fallback. That action validates the path against the Extension Host's currently loaded files and resolves only that file's current single-commit, Range, Selection, or saved working-tree endpoints; it never launches an aggregate or trusts endpoint refs from the Webview. GitAmida writes the two endpoint copies into a private temporary directory and invokes `git difftool --no-index` with an argument array only after the user explicitly requests it. This preserves additions, deletions, renames, working-tree snapshots, image bytes, and unrelated Selection endpoints without asking the external tool to reproduce GitAmida's selection semantics. The configured tool may outlive the launching process, so endpoint copies remain until the Extension Host session ends. Missing or failed tool configuration leaves the native diff open as the fallback.

## File revision restoration

Restoration is a separate working-tree mutation boundary, not an export or an extension of the native diff editor. A historical Changed-files row exposes each endpoint that actually contains a file. The Extension Host resolves that endpoint from its current trusted comparison state, shows its commit and path together with the row's current destination path, and requires a modal confirmation. An absent endpoint is not an instruction to delete anything.

The destination is always the current row path, including when the selected source came from the old side of a rename. Before showing confirmation and again immediately before replacement, reject unsaved editor content, staged or unstaged target changes, existing untracked or ignored targets, unresolved or specially flagged index entries, symbolic-link sources or destination components, submodules, non-files, and paths outside the canonical repository root. Read the selected Git blob as bytes, create a same-directory temporary file, and replace the destination only after a final state check. A missing untracked destination may be created so a file deleted in the current revision can be recovered. Leave the index unchanged so every successful restoration remains an ordinary visible working-tree change. Keep this endpoint writer independent of Repository History UI state so File History can reuse it later.

## Multiple-commit semantics

GitAmida uses **selection-scoped, endpoint-based comparison**. A selection determines which changed paths belong to the investigation; each file diff compares actual Git states at visible endpoints. GitAmida never invents an intermediate tree or presents unrelated branch changes as a merged result.

This rule, rather than compatibility with another product, is the authority for GitAmida's result semantics. IntelliJ IDEA remains an interaction reference, and comparison against its observed behavior is useful supporting evidence when the result also satisfies GitAmida's explainability and safety requirements.

- Include every visible row while constructing a Shift interval, then store the resolved selection by commit hash so later refreshes or ordering changes do not silently change it
- Distinguish internally between a **Range**, which compares two real repository states, and a **Selection**, which investigates an explicit set of commit changes
- Present the primary interaction as a common selected-commit count and use one **Selected commits** details heading; describe the comparison as a continuous range or per-file selected endpoints instead of exposing Range and Selection as modes users must choose or understand
- Show the comparison basis or contributing commits instead of presenting an unexplained combined diff
- Never create a virtual tree by cherry-picking selected commits
- Exclude paths changed only by unselected commits
- For a selected path, make it explicit that the endpoint comparison includes intervening unselected revisions of that same path
- Never imply that endpoint comparison merges changes from unrelated branches

### Range

A Range has explicit oldest and newest endpoints and represents one real before/after comparison. Compare the state immediately before the oldest endpoint with the tree at the newest endpoint, using the empty tree before a root commit. Show deduplicated changed files and open the resulting file comparisons in the native diff editor.

The inspection pane keeps its stable **Commit details** heading. Multiple selection adds a shared **Selected commits** section: identify a Range comparison as a **Continuous range**, keep its comparison basis prominent, then show a compact **Included commits** list matching Repository History using short hashes, subjects, and committed timestamps. Do not repeat complete author metadata for every commit in the limited Panel height; users can still inspect an individual commit by returning to single selection.

Range meaning comes from its displayed base and tip. Use Range only when the visible interval contains exactly its contributing commits; classify an interval with unrelated or date-interleaved rows as Selection instead of silently redefining the Range. A merge at a comparison boundary uses an explicit parent; first parent is the initial default and must be visible to the user.

The current multiple-commit implementation supports single commits, Range, and explicit Selection. It completes the whole path from choosing commits, through aggregated changed files, to native file diffs without manufacturing a repository state that Git does not contain.

Range endpoints must have an ancestor relationship. Use the first parent of the older endpoint as the comparison base, or the empty tree when that endpoint is a root commit. The contributing commit set is every commit reachable from the tip but not from the base, equivalent to `git rev-list base..tip`. This includes side-branch commits merged between the declared base and tip while excluding unrelated date-interleaved rows. When the older endpoint is a merge, show that first-parent choice explicitly. Classify a Shift-selected visible interval with unrelated endpoints as Selection rather than rejecting it or misrepresenting it as Range.

### Selection

A Selection is an explicit set of commits, including a visible interval that cannot be represented exactly as one Range and a set formed by adding or removing individual commits from an initial visual interval. It is a review focus, not a rewritten history. Cmd/Ctrl+click toggles the pointed commit, while Space toggles the focused history row as the keyboard equivalent. A plain click returns to one commit. Shift selects every visible commit row between the anchor and active row without asking the user to choose a mode: use Range only when that visible interval exactly represents one ancestor-related before/after comparison, and otherwise use Selection.

Keep the original Shift anchor while the active end moves so repeated Shift+click or Shift+keyboard navigation expands or contracts the same visible interval. Preserve that anchor even when the interval is classified as Selection rather than Range. Keep Range and Selection as internal classifications and describe only how the selected commits are compared, not which selection mode the user entered.

A Selection may include commits from different branches even when neither is an ancestor of the other. Aggregate only paths changed by the selected commits and keep each contributing commit visible, but do not imply that the selection is one real final repository state.

For each aggregated path, compare the state before its oldest selected change with the state after its newest selected change, using the newest-first order shown in Repository History. A file changed only by an omitted commit stays absent, while an omitted revision of a selected file appears inside that file's endpoint diff. When selected commits come from unrelated branches, the newest contributing commit supplies the after-state; GitAmida does not merge the branches or synthesize a tree. The observed IntelliJ behavior matches these rules, but that observation validates the interaction rather than defining it.

Changed files show how many selected commits contributed to each path. Selecting a file shows its actual before and after endpoint hashes and explains the inclusion of intervening same-path changes. Double-click or Enter opens that endpoint comparison directly in the reusable native preview diff; it does not ask users to choose among contributing commit diffs. The Extension Host derives both endpoints from parsed commit changes, so the Webview never supplies revision IDs for a diff.

The familiar interaction target is Shift selection for an initial visible interval and Cmd/Ctrl toggling for individual inclusion. The interaction may follow IntelliJ conventions, but the displayed result remains governed by the rules above.

### Acceptance invariants

- Ancestor-related Range results match the diff between the declared base and tip
- Shift selection includes unrelated or date-interleaved rows in the visible interval and classifies the result as Selection instead of silently omitting them
- Repeated Shift selection keeps its original anchor while the active end expands or contracts the visible interval
- A file changed only by an omitted commit is absent from Selection results
- An omitted same-file revision is included in the visible endpoint diff and the comparison basis is shown
- Unrelated branch changes to the same path use visible endpoints and are never described as merged
- Merge comparisons identify the active parent
- Additions, deletions, renames, cancellations, and unsupported content remain explicit rather than being dropped during deduplication

### Entire branch

Treat the range from the merge base with an explicit or inferred base branch through the target branch as one change. Always allow correction of an inferred base.

## Technology choices

### TypeScript extension

Implement GitAmida as one TypeScript extension.

- Cursor and VS Code provide the Extension Host runtime to installed extensions
- The View Container API makes GitAmida visible beside built-in Panel tools
- The native diff supplies selection, scrolling, syntax highlighting, accessibility, and familiar mouse behavior
- A single frontend avoids duplicating selection and navigation behavior

Node.js is a development and build tool only. Extension users do not need to install Node.js.

Create local evaluation packages with the exact `@vscode/vsce` development dependency and the repository's `npm run package:vsix` command. The command runs the build first and packages only the JavaScript, Webview assets, manifest, and README declared by the `files` allowlist. Publishing credentials and signing are outside this checkpoint, so lifecycle scripts for the transitive credential and signing helpers remain explicitly denied. Local packaging may skip the license-file check while the manifest is `UNLICENSED`; public distribution requires a separate license and publication review.

### Webview View

Use a Webview View because a topology graph, compact data grid, resizable details split, and multiple internal history tabs exceed what one native Tree View represents well.

- Use VS Code theme tokens instead of copying another product's presentation
- Compile browser-targeted TypeScript separately from the Extension Host without a framework, bundler, or runtime dependency
- Keep all scripts and styles local
- Apply a restrictive Content Security Policy with a per-render nonce
- Render Git data through DOM text nodes, never HTML interpolation
- Validate every message at the Extension Host boundary
- Provide complete keyboard equivalents and visible focus
- Preserve responsive reflow and usable target sizes

### Git CLI

Invoke the locally installed Git CLI from the Extension Host instead of parsing `.git` directly.

- Run `execFile` with an argument array and never use a shell
- Disable color, pagers, and external diff behavior for parsed output; invoke a configured difftool only across the separate explicit opener boundary
- Use NUL-delimited output for paths
- Apply operation-specific history, output, and time limits
- Treat Git output and Webview messages as untrusted input

The evaluation build temporarily loads every commit reachable from local branches, remote-tracking branches, and tags in one request, while retaining the operation timeout and output limit. This exists to measure real repository behavior and is not the intended distribution strategy.

The production target uses 100 commits as a page size, not a product limit. Prefetch the next page automatically before the user reaches the end of the current rows, preserve graph, selection, and scroll state, and continue until all reachable history is available. Do not require a routine **Load more** action. Show an explicit retry only when automatic loading fails.

## Logical architecture

The Webview renders trusted view models and emits validated user intentions. Extension Host application services own repository state, Repository History, open File History sessions, Git queries, branch-switch preflight, and virtual diff documents. The Git adapter does not import VS Code or Webview types.

Observe the built-in Git extension's repository change event and debounce bursts. Refresh only the working-tree snapshot while HEAD and refs are unchanged; reload complete history when HEAD, branch, or local, remote-tracking, or tag refs change. Also schedule a working-tree refresh directly after a file document is saved so editor changes do not depend on the Git extension's refresh timing. Continue refreshing while the retained View is hidden. When it becomes visible, compare a lightweight fingerprint of HEAD, the current branch, and refs with the last loaded history before choosing the smallest refresh; this closes missed-event gaps without polling or monitoring a particular command source. Preserve the selected commit, selected file, and both list scroll positions across a successful automatic reload. Keep the existing view visible when a background refresh fails and offer inline retry. Keep **GitAmida: Refresh** available from the Command Palette, but do not reserve a routine refresh button in the UI.

Presentation preferences such as Flat or Tree mode, divider ratios, and details visibility belong to extension-global state so one adjustment applies to every workspace in the current editor profile. Repository-specific navigation state, including the selected commit and file, belongs to workspace state. Transient interactions such as tree-folder expansion are not persisted. Future behavioral options such as commit ordering must also have one global value rather than accumulating workspace overrides.

Do not introduce a second frontend or shared cross-language core unless a current product requirement justifies it.

## Safety and independence

History queries, file inspection, and diff operations are read-only. Named-branch switching and explicit single-file restoration are the only working-tree mutations; each follows its own preflighted application boundary and neither stages, stashes, discards, forces, or edits Git history.

GitAmida may learn from general history-viewer workflows, but it must derive its hierarchy and interactions from its own requirements. Do not reproduce JetBrains wording, icons, colors, assets, screenshots, or source code, and do not imply affiliation.
