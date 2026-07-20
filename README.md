# GitAmida

GitAmida is an editor-independent Git history viewer for reviewing multiple commits quickly as a single unit of change.

> A human-first Git history viewer for reviewing multiple commits as one change.

The project is currently in the design and MVP preparation stage.

## Problem

Typical Git history viewers either occupy the editor area or make it difficult to follow files changed across multiple commits as one coherent unit. GitAmida keeps the history visible in a terminal UI and opens only the files you need in its internal diff viewer or an external editor.

The initial goal is this experience:

> Open GitAmida from a terminal in Cursor, VS Code, the Codex app, Ghostty, or another environment; select multiple commits in the commit graph; and review the files changed by those commits together.

## Core interactions

- View the commit graph, including branch divergence and merges
- Select one commit, a contiguous range, or multiple non-contiguous commits
- View files changed by the selected commits in a tree
- Select a file and review a unified or side-by-side diff
- Change how whitespace is handled
- Send a detailed diff to a supported external tool
- Use either the keyboard or mouse

Images receive a lightweight preview inside the TUI. Detailed comparison is delegated to an external diff tool such as Kaleidoscope.

## Product principles

- **Human-first**: Prioritize direct human inspection over AI-generated summaries
- **Read-first**: Focus on browsing Git history and diffs
- **Multiple commits as one view**: Treat several commits as a single unit of work
- **Editor-independent**: Keep the core product independent of any specific editor
- **Safe**: Exclude history-changing operations from the initial scope
- **Fast**: Load history and diffs lazily, when they are needed
- **Focused**: Concentrate on change review rather than becoming a general-purpose Git client
- **Evidence-driven minimalism**: Start with a small core and retain only features proven useful in practice

## Initially out of scope

- commit, amend, merge, rebase, and cherry-pick
- reset, revert, and stash
- push, pull, and fetch
- branch creation and deletion
- conflict resolution
- AI-generated summaries or reviews
- Native VS Code/Cursor panels, which are not currently planned

Branch switching may be considered after the read-only experience is stable and its safety constraints are defined.

## Technical direction

- Go
- Bubble Tea v2
- Bubbles v2
- Lip Gloss v2
- The Git CLI first, rather than a Git object library

The GitAmida core is distributed as a single Go binary. Integrations with VS Code, Cursor, and Kaleidoscope are small adapters kept separate from the core.

An early, thin VS Code/Cursor extension will create or reveal a dedicated terminal from a status bar item. It will not duplicate Git parsing or TUI behavior.

## Documentation

- [DESIGN.md](./DESIGN.md): Current architecture and the reasons behind non-obvious decisions
- [ROADMAP.md](./ROADMAP.md): Planned work and its order
- [AGENTS.md](./AGENTS.md): Development conventions and instructions for AI agents
