# GitAmida

GitAmida is a Git history navigator for Cursor and VS Code. It keeps repository history visible in the bottom Panel while opening detailed file comparisons in the editor's native diff view.

> Follow changes from repository history to file history and back without losing context.

## Product direction

Repository History is the center of the product. It provides a compact commit graph, changed files, and details for the selected commit.

File histories are supporting investigations. Users can open several file-history tabs from Repository History, the Explorer, or an active editor, keep them open independently, and return from any file revision to its commit in Repository History.

GitAmida focuses on understanding history rather than becoming a general-purpose Git client. It supports safe named-branch switching and explicit restoration of one historical file into the working tree, but it will not switch directly to arbitrary commits. The commit ID remains easy to copy for users who intentionally want to enter detached HEAD from a terminal.

## Current MVP

- Adds `GitAmida` beside Terminal, Problems, and Output in the bottom Panel
- Loads commits reachable from local branches, remote-tracking branches, tags, and registered non-prunable worktree HEADs in 100-commit pages, automatically prefetches near the visible end without a routine Load-more control, and preserves commit-date order without placing a parent before its children
- Shows a theme-aware lane graph derived from commit parents, keeps the primary-branch backbone visually stable, joins lines at their parent nodes, and places a non-wrapping subject, inline ref indicators, and authored date on one physical row
- Marks local HEAD with a ring-and-center-dot graph node that retains its lane color and a matching-shape themeable yellow inline symbol without a literal `HEAD` label, uses a subdued neutral tag color, groups every co-located branch's HEAD, local, and remote indicators without adding labels beyond the current branch and compact orientation anchors, and shows the short commit hash when detached
- Marks a commit checked out by another worktree with one neutral overlapping-frame symbol and lists each linked path with its branch or detached state in commit details, without adding worktree management or linked dirty-state inspection
- Shows saved staged, unstaged, and untracked paths in a distinct **Uncommitted changes** row without treating it as a commit or including it in Range and Selection
- Refreshes working-tree changes after editor saves and from debounced Git events, including while the retained Panel view is hidden, reloads complete history only when HEAD, refs, or registered worktree HEADs change, rechecks that distinction when the Panel becomes visible, and provides a manual Refresh action in the native View title
- Shows status-colored changed-file paths with theme-aware file, image, binary, submodule, oversized-file, and folder icons in Flat or initially expanded Tree mode, with compact expand-all and collapse-all actions beside the Path heading
- Shows the full subject, non-empty multi-line message body, and commit metadata in a resizable, collapsible details pane
- Selects every visible commit row between the Shift anchor and active row, keeps that anchor while the interval expands or contracts, and automatically uses Range only when the selected rows exactly represent one ancestor-related comparison
- Uses explicit Selection automatically for divergent, unrelated, or date-interleaved visible intervals, while presenting one common selected-commit count and explaining the resolved comparison basis in details
- Adds or removes individual commits with Cmd/Ctrl+click or Space, including unrelated branches, without presenting the result as a hypothetical merged tree
- Deduplicates paths changed by selected commits and opens each file directly from its oldest selected before-state to its newest selected after-state, including intervening revisions of that path without pretending to merge branches
- Keeps Repository History selection while navigating or refreshing in the current session, then starts from the newest visible commit after an editor restart or window reload instead of restoring a stale Range or Selection
- Opens full renamed-path history from a Changed-files row, an Explorer file, or the active editor in reusable, closable File History tabs, with status-colored paths and the selected revision's commit details; the tab strip appears only while file investigations exist, a compact home tab returns to Repository History, and filename-sized tabs scroll horizontally instead of shrinking or wrapping
- Returns from a File History revision to its selected commit in Repository History through the revision context menu, retaining the file tab and loading older repository-history pages when necessary
- Resizes and preserves the split between Repository History and changed-file inspection across workspaces in the same editor profile
- Opens single-commit, Range, and Selection comparisons in one reusable native preview diff on single-click or keyboard navigation; double-click, Enter, and **Open Changes** pin the text or supported-image comparison, while replaced previews and closed pinned tabs release their virtual content and image resources
- Opens one current Changed-files row in the user-configured Git difftool from its context menu, and also exposes the same action from an active GitAmida native diff when the editor API identifies that tab reliably
- Restores either available before or after endpoint of one historical Changed-files row directly to that row's current working-tree path after an explicit confirmation, while refusing unsaved, staged, unstaged, untracked, symlink, and submodule targets and leaving the index unchanged
- Switches to another local branch from a commit's context menu or the Command Palette only after rejecting unsaved editors, dirty worktrees, in-progress Git operations, and targets occupied by another worktree
- Compares normal commits with their first parent and root commits with Git's empty tree
- Compares saved working-tree and historical `.jpg`, `.jpe`, `.jpeg`, `.png`, `.bmp`, `.gif`, `.ico`, `.webp`, `.avif`, and `.svg` states through the editor's native image comparison, including empty endpoints for additions and deletions
- Keeps other binary files, submodules, and text blobs beyond the current VS Code/Cursor `diffEditor.maxFileSize` setting visible and labeled without decoding them as text
- Runs Git queries and blob reads without a shell, cancels superseded history and content requests, applies operation-specific time and output bounds, and records slow or failed operations in the local GitAmida Output channel; the explicit restore action writes only its confirmed working-tree destination
- Uses the active workspace folder, or the first workspace folder when no editor is active
- Presents no workspace, a non-Git folder, and a Git repository without commits as distinct empty states instead of generic Git failures

Whitespace options and multi-root repository selection are planned but not implemented yet.

## Try it in Cursor

Development uses Node.js 24 and npm 11.16 through mise. Extension users do not need to install Node.js because the compiled extension runs in the editor's Extension Host.

```sh
mise install
npm ci
npm run build
```

Open this repository in Cursor, press `F5`, and choose **Run GitAmida Extension** if prompted. In the Extension Development Host, run **GitAmida: Open** from the command palette. Save a file to inspect the automatically updated **Uncommitted changes** row, or use the Refresh action in the GitAmida View title after an external repository or linked-worktree operation. Click a commit, then Shift+click another visible commit to select every row in between; GitAmida automatically chooses the safe Range or Selection comparison. Use Cmd/Ctrl+click to toggle individual commits. With a history row focused, Shift+Arrow extends the visible interval and Space toggles the focused commit. Click or keyboard-navigate to a changed file to reuse one preview diff; double-click, press Enter, or choose **Open Changes** from its context menu to pin that endpoint comparison. Choose **Show File History** from a Changed-files row, choose **GitAmida: Show File History** from an Explorer file, or use the active editor's action of the same name to open its full renamed-path history in an internal tab. Click a revision to preview its first-parent diff, or press Enter or double-click to keep that diff open. Right-click or Control-click a revision and choose **Show in Repository History** to return to that commit in the repository graph without closing the file tab. When Git's `diff.tool` is configured, choose **GitAmida: Open in Git Difftool** from that diff's editor title, or the shorter **Open in Git Difftool** from a Changed-files row, to reopen the same endpoints in the configured tool. To restore one displayed endpoint, right-click a historical Changed-files row, open **Restore Working Tree File**, and choose the available after or before version. Confirm the source and destination; GitAmida writes the working-tree file without staging it and refuses to overwrite existing local changes. To switch safely, right-click a commit that has another local branch or focus it and run **GitAmida: Switch Branch…**. GitAmida leaves the repository unchanged and explains the reason whenever a requested mutation is unsafe.

## Install locally

Create an unsigned local VSIX after a clean install:

```sh
npm ci
npm run package:vsix
```

The command prints the generated filename. Install the current package in Cursor with:

```sh
cursor --install-extension git-amida-0.0.1.vsix --force
```

Use `code --install-extension git-amida-0.0.1.vsix --force` for VS Code when its CLI is available. Reload the editor window after installing or replacing the same local version. Generated `*.vsix` files are local artifacts and remain ignored by Git.

This command deliberately skips a license-file requirement only for local evaluation while the package is marked `UNLICENSED`. Define the public license and use a reviewed publication workflow before distributing GitAmida.

## Comprehensive validation repository

Create a separate synthetic repository for end-to-end testing and publication screenshots without using private project history:

```sh
node scripts/create-demo-repository.mjs /absolute/path/to/git-amida-demo
```

The generator uses only Node.js standard APIs and the Git CLI. It creates the main demo repository, a local submodule source, a branch-backed review worktree, and a detached agent-style worktree, and refuses to overwrite any existing target. After building GitAmida, run `node scripts/validate-demo-repository.mjs /absolute/path/to/git-amida-demo` to verify the fixtures through the production Git adapter. The generated repository README identifies screenshot-friendly commits; its validation guide covers graph, File History, image, binary, oversized-file, worktree, and safe-mutation scenarios.

## AI parallel-worktree repository

Model a plausible AI-assisted development session separately from both the normal screenshot repository and the pathological graph stress repository:

```sh
node scripts/create-ai-parallel-repository.mjs /absolute/path/to/git-amida-ai-parallel-demo
npm run build
node scripts/validate-ai-parallel-repository.mjs /absolute/path/to/git-amida-ai-parallel-demo
```

The generated repository retains six branch-backed agent worktrees and two detached agent worktrees, each with one to three focused commits. Its older history also contains four short agent tasks that were merged and whose branches were deleted. The result models a brief fan-out around active AI work without treating 24 sustained lanes as normal. The linked worktrees live under the sibling `<target>-agents` directory; the generator refuses to overwrite either generated location.

## Dense graph stress repository

Keep pathological graph-density checks separate from the screenshot-friendly comprehensive demo:

```sh
node scripts/create-graph-stress-repository.mjs /absolute/path/to/git-amida-graph-stress-demo
npm run build
node scripts/validate-graph-stress-repository.mjs /absolute/path/to/git-amida-graph-stress-demo
```

The generated repository progresses through 4, 8, 12, 16, and 24 simultaneous lanes, then keeps all 24 active across a long main-branch corridor before converging them at one shared root. Use it to inspect bounded graph width, compressed lane spacing, repeated theme colors, scrolling, selection, and narrow-Panel alignment without making the normal demo permanently dense.

## Product principles

- **Repository history first**: Keep the repository-wide log as the stable center of navigation
- **History stays visible**: Preserve review context while files and diffs open elsewhere
- **Natural traversal**: Move between repository history, several file histories, and diffs without discarding state
- **Dense but readable**: Keep every commit on one row and move secondary information into details
- **Explainable aggregation**: Let selected commits define the file scope, compare actual Git states at visible endpoints, and never imply a synthesized tree or branch merge
- **Safe workspace changes**: Keep named-branch switching and single-file restoration behind explicit preflight checks and confirmation, with no automatic stash, staging, discard, or force
- **Focused**: Exclude history editing and unrelated Git-client operations
- **Evidence-driven minimalism**: Keep only features that prove useful in daily use

## Documentation

- [DESIGN.md](./DESIGN.md): Current architecture and reasons behind non-obvious decisions
- [ROADMAP.md](./ROADMAP.md): Upcoming work and its validation order
- [AGENTS.md](./AGENTS.md): Development conventions and instructions for AI agents
