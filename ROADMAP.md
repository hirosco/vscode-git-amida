# GitAmida Roadmap

GitAmida's initial definition of done is:

> From any terminal, open GitAmida, select multiple commits in the commit graph, review their aggregated changed files, and open a selected file's diff internally or in an external tool.

## 1. Technical validation

Before production implementation, use small spikes to resolve only the uncertainties that affect the core experience.

- Verify multiple panes, resizing, keyboard input, clicks, double-clicks, and wheel input with Bubble Tea v2
- Build a minimal graph model that represents divergence and merges from Git log data
- Retrieve the changed files and diff for a single commit safely
- Send temporary files to the VS Code CLI for comparison
- Send images materialized from Git blobs to `ksdiff` and verify temporary-file lifetime
- Verify input and rendering in Ghostty and the terminals embedded in Cursor and the Codex app
- Verify that VS Code and Cursor can create and reveal a dedicated terminal from a status bar item

This milestone is complete when measurements and minimal demonstrations are sufficient to choose implementation approaches, with no unnecessary spike code retained in the product.

## 2. Single-commit MVP

Complete the basic read-only path through Git history first.

- Start inside a repository or accept one through `--repo`
- Show the current repository, branch, and HEAD
- Show a commit graph with an initial history limit
- Select one commit
- Show a changed-file tree that handles additions, modifications, deletions, and renames
- Show the selected file's unified diff inside the TUI
- Move between panes, select items, and scroll with either keyboard or mouse
- Degrade safely for root commits, merge commits, binary files, and oversized diffs

This milestone is complete when users can select a commit in an everyday repository and move reliably between its changed files and diffs.

## 3. VS Code/Cursor launch extension

Make GitAmida discoverable inside the editor and launchable without typing a command.

- Show `GitAmida` on the left side of the status bar when a Git repository is open
- Launch from the status bar item and the `GitAmida: Open` command
- Create a dedicated terminal named `GitAmida`
- Reveal an existing running terminal instead of creating another
- Pass the current workspace folder through `--repo`
- Allow repository selection in a multi-root workspace
- Show concise installation guidance when the Go binary is unavailable
- Test the same VSIX in both VS Code and Cursor

The extension must not implement Git parsing, commit selection, or diff presentation. This milestone is complete when one click on the status bar opens the TUI in both VS Code and Cursor.

## 4. Multiple-commit MVP

Implement GitAmida's distinctive core value.

- Add selection toggles and contiguous range selection
- Show the selected commits
- Aggregate and deduplicate changed files
- Show the commits relevant to each file
- Show the final diff for a contiguous range
- Show per-commit diffs chronologically for a non-contiguous selection
- Cancel stale requests when the selection changes and prevent old results from overwriting the screen

This milestone is complete when users understand the difference between single, contiguous, and non-contiguous selections and can reach the expected changes in every case.

## 5. Diff experience

Improve human-readable presentation and external-tool integration.

- Switch among unified, side-by-side, and word diffs
- Degrade safely from side-by-side to unified in narrow terminals
- Toggle ignoring trailing whitespace, whitespace amount, all whitespace, or blank-line changes
- Change the number of diff context lines
- Add an opener for side-by-side diffs in VS Code
- Verify Cursor editor CLI integration and add an opener if it is reliable
- Add a Kaleidoscope opener
- Explain missing external tools and fall back to the internal diff

This milestone is complete when users can inspect the same file internally and in any available external diff tool without losing the current history selection.

## 6. Image diffs

Add image inspection without compromising the text-first experience.

- Detect image formats and dimensions
- Show lightweight before-and-after previews in supported terminals
- Show metadata and an external-tool action in unsupported terminals
- Open detailed comparisons in Kaleidoscope
- Move decoding, resizing, and rendering of large images off the UI thread

Advanced zooming, slider comparisons, and pixel-level diffs are not completion requirements for this milestone.

## 7. Branch-level review

Extend the commit-selection model to an entire branch.

- Show local and remote-tracking branches
- Select a base branch explicitly
- Show commits from the merge base through the target branch
- Show aggregated changed files and the final diff for the branch
- Suggest a base branch while allowing the user to correct it

Keep branch switching separate from read-only review. Decide whether to add it only after defining its safety constraints.

## 8. Large repositories and distribution

Reach everyday performance and establish distribution paths.

- Implement history pagination and incremental loading
- Add diff-size limits, timeouts, and cancellation
- Verify major interactions on macOS, Linux, and Windows
- Provide version output, diagnostics, and an issue-reporting path
- Produce release binaries and checksums
- Choose distribution methods such as Homebrew
- Review the product name, package names, trademarks, and license before publication

## 9. Historical file exploration

Add a separate workflow for finding old files so users need fewer `backup/` directories in repositories.

- Search for deleted files
- Search paths that existed in the past
- Open a file immediately before deletion or at a selected commit
- Follow rename history
- Show the complete history of one file
- Use the operating system cache directory and invalidate cached data when refs change
