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
- Shows a theme-aware lane graph derived from commit parents, a non-wrapping subject, inline ref indicators, and date on one physical row
- Marks local and remote HEAD positions with an unbordered icon-and-text `HEAD` indicator; local refs are filled, remote refs are outlined, and tags use a distinct shape
- Shows changed files in Flat or initially expanded Tree mode, with expand-all and collapse-all actions
- Shows full commit metadata in a resizable, collapsible details pane
- Selects an ancestor-related commit Range with Shift+click, shows its explicit base, tip, and contributing commits across merges, and aggregates the final changed files from that comparison
- Adds or removes individual commits with Cmd/Ctrl+click or Space, including unrelated branches, and labels the result as an explicit Selection rather than a hypothetical merged tree
- Deduplicates Selection files, identifies every contributing commit, and offers one combined file diff only when the selected revisions form an exact chain; otherwise it offers the real per-commit diffs
- Resizes and preserves the split between Repository History and changed-file inspection across workspaces in the same editor profile
- Opens single-commit, Range, and Selection comparisons in one reusable native preview diff on double-click or Enter; pinning remains available through the editor
- Compares normal commits with their first parent and root commits with Git's empty tree
- Keeps raster images, binary files, submodules, and text blobs over 5 MiB visible and labeled without decoding them as text
- Runs read-only Git commands without a shell
- Uses the active workspace folder, or the first workspace folder when no editor is active

Paged automatic history loading, file-history tabs, branch switching, image diffs, whitespace options, and multi-root repository selection are planned but not implemented yet.

## Try it in Cursor

Development uses Node.js 24 and npm 11.16 through mise. Extension users do not need to install Node.js because the compiled extension runs in the editor's Extension Host.

```sh
mise install
npm ci
npm run build
```

Open this repository in Cursor, press `F5`, and choose **Run GitAmida Extension** if prompted. In the Extension Development Host, run **GitAmida: Open** from the command palette. Click a commit, Shift+click an ancestor-related commit to select a Range, or use Cmd/Ctrl+click to toggle commits in an explicit Selection. With a history row focused, Space provides the same toggle action. Double-click a changed file to open its diff without replacing the history panel; when one safe combined Selection diff does not exist, choose one of its contributing commit diffs.

## Product principles

- **Repository history first**: Keep the repository-wide log as the stable center of navigation
- **History stays visible**: Preserve review context while files and diffs open elsewhere
- **Natural traversal**: Move between repository history, several file histories, and diffs without discarding state
- **Dense but readable**: Keep every commit on one row and move secondary information into details
- **Multiple commits as one view**: Treat several commits as one coherent change when explicitly selected
- **Safe workspace changes**: Add branch switching only with explicit preflight checks and no automatic stash or force
- **Focused**: Exclude history editing and unrelated Git-client operations
- **Evidence-driven minimalism**: Keep only features that prove useful in daily use

## Documentation

- [DESIGN.md](./DESIGN.md): Current architecture and reasons behind non-obvious decisions
- [ROADMAP.md](./ROADMAP.md): Upcoming work and its validation order
- [AGENTS.md](./AGENTS.md): Development conventions and instructions for AI agents
