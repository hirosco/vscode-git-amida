# AGENTS.md

## Project overview

GitAmida is a terminal UI written in Go for reviewing multiple Git commits as one unit of change. It is not a general-purpose Git client; it focuses on browsing history, changed files, and diffs.

The project is currently in the design and MVP preparation stage. Read `README.md`, `DESIGN.md`, and `ROADMAP.md` before implementation.

## Canonical documents

- `AGENTS.md`: Development procedures, conventions, and pitfalls
- `DESIGN.md`: Current architecture and reasons behind non-obvious decisions
- `ROADMAP.md`: Upcoming work and why it matters

Do not create append-only completion histories or decision logs. Update the documents above to reflect the current truth and leave historical context to Git.

## Language policy

- Keep canonical repository documentation, code, identifiers, comments, and commit messages in English.
- Communicate progress, reviews, explanations, and handoffs to the project owner in Japanese unless requested otherwise.
- When changing English documentation, summarize the material changes and their rationale in Japanese.
- Do not maintain complete translated copies of canonical documents. Add a concise localized guide only when a real user need justifies its maintenance cost.

## Implementation principles

- Prefer the smallest relevant change and avoid unrelated refactoring.
- Keep the GitAmida core entirely in Go.
- Limit the VS Code/Cursor extension to a launch adapter; it must not contain Git parsing or screen logic.
- Build the smallest unit that can validate user value instead of adding features based only on assumptions.
- Do not retain unused features merely because they were expensive to build. Keep boundaries that allow safe removal or reduction.
- Separate UI, Git execution, domain logic, and external-tool integration.
- Never block Bubble Tea's `Update`; perform I/O as cancellable commands.
- Provide an equivalent keyboard action for every mouse action.
- Degrade safely when terminal width or capabilities are insufficient.
- Do not add operations that change Git history without an explicit design change.

## Intended directory structure

```text
cmd/git-amida/       CLI entry point
internal/app/        Use cases and asynchronous orchestration
internal/domain/     Commit selection, change aggregation, and view models
internal/git/        Git CLI execution and output parsing
internal/tui/        Bubble Tea screens, input, and rendering
internal/diff/       Diff model and presentation modes
internal/opener/     Internal and external diff openers
internal/config/     Configuration loading and validation
extensions/vscode/   Optional status bar and terminal launch adapter
testdata/            Fixed parsing fixtures
```

Do not create packages before the initial implementation needs them.

## Git CLI handling

- Do not construct shell command strings. Pass the executable and arguments separately to `exec.CommandContext`.
- Put `--` before path arguments to avoid ambiguity between revisions and paths.
- Disable color, pagers, and external diffs for machine-parsed output.
- Preserve Git exit codes and standard error, then translate them into user-facing errors.
- Apply output limits, lazy loading, and cancellation to potentially large operations.
- Avoid parsing behavior that depends on the user's global Git configuration.
- Permit only read-only commands in the initial scope.

## Diff conventions

- For a single commit, normally compare its parent with the selected commit.
- Compare a root commit with Git's empty tree.
- For a contiguous range, show the final diff from immediately before the oldest commit to the newest commit.
- Do not construct a virtual tree for non-contiguous selections. Aggregate changed files and show per-commit diffs.
- Generate unified, side-by-side, and word diffs from the same diff model.
- Treat whitespace-ignore settings as explicit diff-generation inputs, not presentation-only options.
- Distinguish renames, deletions, binary files, submodules, and oversized diffs from ordinary text changes.

## External-tool integration

- Add external tools as implementations of the `opener` interface.
- Do not embed `code`, Kaleidoscope, or arbitrary commands directly in Git logic.
- Launch external processes without a shell.
- Place temporary files created from Git blobs in a dedicated working directory, with explicit permissions and cleanup timing.
- If a tool is unavailable, fall back to the internal diff and never install it automatically.

## Testing

- Test domain logic independently of Git and the TUI with table-driven tests.
- Test Git parsing with fixed fixtures and small repositories created in temporary directories.
- Never change the user's real repositories or global Git configuration during tests.
- Prioritize state-transition tests and golden tests for major TUI views.
- Test keyboard paths as well as mouse paths.

## UI and intellectual-property considerations

- Abstract useful interaction ideas from existing IDEs into GitAmida's own requirements.
- Do not faithfully reproduce a specific product's layout, wording, icons, colors, or imagery.
- Do not import JetBrains source code, assets, or screenshots without permission.
- Do not use names or presentation that imply affiliation or official compatibility with another product.

## Git workflow

- Write commit messages in English and follow Conventional Commits.
- Use `feature/<topic>` for new branches by default.
- Use `git switch` to change branches and `git restore` to restore files.
- Preserve existing user changes and do not mix unrelated work into the task.
