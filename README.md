# GitAmida

GitAmida is an experimental Git history view for Cursor and VS Code. It keeps commit history and changed files in the bottom Panel while opening detailed file comparisons in the editor's native diff view.

> Review Git history without losing the history context when a diff opens.

This branch tests an editor-native alternative to the terminal UI prototype. The two implementations intentionally remain on separate branches until hands-on use provides enough evidence to choose a direction.

## Current MVP

- Adds `GitAmida` beside Terminal, Problems, and Output in the bottom Panel
- Shows up to 100 commits with Git's topology graph, subject, refs, hash, and date
- Shows the files changed by one selected commit
- Opens a file in the editor's native side-by-side diff on double-click or Enter
- Compares normal commits with their first parent and root commits with Git's empty tree
- Runs read-only Git commands without a shell
- Uses the active workspace folder, or the first workspace folder when no editor is active

The MVP intentionally excludes multiple-commit selection, file-tree grouping, image diffs, whitespace options, repository selection in multi-root workspaces, and Git-changing operations.

## Try it in Cursor

Development uses Node.js 24 and npm 11.16 through mise. Extension users do not need to install Node.js because the compiled extension runs in the editor's Extension Host.

```sh
mise install
npm ci
npm run build
```

Open this repository in Cursor, press `F5`, and choose **Run GitAmida Extension** if prompted. In the Extension Development Host, click **GitAmida** in the bottom Panel. Click a commit, then double-click a changed file to open its diff without replacing the history panel.

The command palette also exposes **GitAmida: Open** and **GitAmida: Refresh**.

## Product principles

- **Human-first**: Prioritize direct inspection over generated summaries
- **Read-first**: Focus on browsing history, changed files, and diffs
- **History stays visible**: Keep review context in a supporting editor panel
- **Multiple commits as one view**: Treat several commits as a coherent change in the next product milestone
- **Safe**: Exclude history-changing operations from the initial scope
- **Focused**: Do not become a general-purpose Git client
- **Evidence-driven minimalism**: Keep only features that prove useful in daily use

## Documentation

- [DESIGN.md](./DESIGN.md): Current architecture and reasons behind non-obvious decisions
- [ROADMAP.md](./ROADMAP.md): Upcoming work and the comparison checkpoint
- [AGENTS.md](./AGENTS.md): Development conventions and instructions for AI agents
