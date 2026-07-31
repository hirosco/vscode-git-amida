# GitAmida

GitAmida is a Git history navigator for Cursor and VS Code. It keeps repository history visible in the bottom Panel while opening detailed file comparisons in the editor's native diff view.

> Follow changes from repository history to file history and back without losing context.

## Product direction

Repository History is the center of the product. It provides a compact commit graph, changed files, and details for the selected commit.

File histories are supporting investigations. Users can open several file-history tabs from Repository History, the Explorer, or an editor, keep them open independently, and return from any file revision to its commit in Repository History.

GitAmida focuses on understanding history rather than becoming a general-purpose Git client. It will support safe branch switching, but it will not switch directly to arbitrary commits. The commit ID remains easy to copy for users who intentionally want to enter detached HEAD from a terminal.

## Current MVP

- Adds `GitAmida` beside Terminal, Problems, and Output in the bottom Panel
- Loads all commits reachable from local branches, remote-tracking branches, and tags in one bounded evaluation pass, ordered by commit date without placing a parent before its children
- Shows a theme-aware lane graph derived from commit parents, keeps the primary-branch backbone visually stable, joins lines at their parent nodes, and places a non-wrapping subject, inline ref indicators, and date on one physical row
- Marks local HEAD with a ring-and-center-dot graph node, labels it with the checked-out branch or short commit hash when detached, retains the remote `HEAD` indicator, labels local and remote `main` or `master` positions independently, and keeps other refs compact through fill and shape
- Shows saved staged, unstaged, and untracked paths in a distinct **Uncommitted changes** row without treating it as a commit or including it in Range and Selection
- Refreshes working-tree changes after editor saves and from debounced Git events, including while the retained Panel view is hidden, reloads complete history only when HEAD or refs change, and rechecks that distinction when the Panel becomes visible
- Shows status-colored changed-file paths with theme-aware file, image, binary, submodule, oversized-file, and folder icons in Flat or initially expanded Tree mode, with compact expand-all and collapse-all actions beside the Path heading
- Shows full commit metadata in a resizable, collapsible details pane
- Selects every visible commit row between the Shift anchor and active row, keeps that anchor while the interval expands or contracts, and automatically uses Range only when the selected rows exactly represent one ancestor-related comparison
- Uses explicit Selection automatically for divergent, unrelated, or date-interleaved visible intervals, while presenting one common selected-commit count and explaining the resolved comparison basis in details
- Adds or removes individual commits with Cmd/Ctrl+click or Space, including unrelated branches, without presenting the result as a hypothetical merged tree
- Deduplicates paths changed by selected commits and opens each file directly from its oldest selected before-state to its newest selected after-state, including intervening revisions of that path without pretending to merge branches
- Resizes and preserves the split between Repository History and changed-file inspection across workspaces in the same editor profile
- Opens single-commit, Range, and Selection comparisons in one reusable native preview diff on double-click or Enter; supported images use the editor's native image comparison and pinning remains available through the editor
- Switches to another local branch from a commit's context menu or the Command Palette only after rejecting unsaved editors, dirty worktrees, in-progress Git operations, and targets occupied by another worktree
- Compares normal commits with their first parent and root commits with Git's empty tree
- Compares saved working-tree and historical `.jpg`, `.jpe`, `.jpeg`, `.png`, `.bmp`, `.gif`, `.ico`, `.webp`, `.avif`, and `.svg` states through the editor's native image comparison, including empty endpoints for additions and deletions
- Keeps other binary files, submodules, and text blobs beyond the current VS Code/Cursor `diffEditor.maxFileSize` setting visible and labeled without decoding them as text
- Runs read-only Git commands without a shell
- Uses the active workspace folder, or the first workspace folder when no editor is active

Paged automatic history loading, file-history tabs, remote-tracking branch creation, whitespace options, and multi-root repository selection are planned but not implemented yet.

## Try it in Cursor

Development uses Node.js 24 and npm 11.16 through mise. Extension users do not need to install Node.js because the compiled extension runs in the editor's Extension Host.

```sh
mise install
npm ci
npm run build
```

Open this repository in Cursor, press `F5`, and choose **Run GitAmida Extension** if prompted. In the Extension Development Host, run **GitAmida: Open** from the command palette. Save a file to inspect the automatically updated **Uncommitted changes** row. Click a commit, then Shift+click another visible commit to select every row in between; GitAmida automatically chooses the safe Range or Selection comparison. Use Cmd/Ctrl+click to toggle individual commits. With a history row focused, Shift+Arrow extends the visible interval and Space toggles the focused commit. Double-click a changed file to open its endpoint diff without replacing the history panel; the next file reuses that preview tab unless you pin it through the editor. To switch safely, right-click a commit that has another local branch or focus it and run **GitAmida: Switch Branch…**. GitAmida leaves the repository unchanged and explains the reason whenever the current worktree is not clean or the target is unsafe.

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

## Product principles

- **Repository history first**: Keep the repository-wide log as the stable center of navigation
- **History stays visible**: Preserve review context while files and diffs open elsewhere
- **Natural traversal**: Move between repository history, several file histories, and diffs without discarding state
- **Dense but readable**: Keep every commit on one row and move secondary information into details
- **Explainable aggregation**: Let selected commits define the file scope, compare actual Git states at visible endpoints, and never imply a synthesized tree or branch merge
- **Safe workspace changes**: Add branch switching only with explicit preflight checks and no automatic stash or force
- **Focused**: Exclude history editing and unrelated Git-client operations
- **Evidence-driven minimalism**: Keep only features that prove useful in daily use

## Documentation

- [DESIGN.md](./DESIGN.md): Current architecture and reasons behind non-obvious decisions
- [ROADMAP.md](./ROADMAP.md): Upcoming work and its validation order
- [AGENTS.md](./AGENTS.md): Development conventions and instructions for AI agents
