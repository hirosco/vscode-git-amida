# Changelog

All notable changes to GitAmida will be documented in this file.

## 0.0.4 - 2026-08-16

### Added

- Conflict-aware **Uncommitted changes** summaries and separate **Merge Changes** and **Changes** groups
- In-progress merge, rebase, cherry-pick, and revert labels, with generic conflict reporting for stash application and other unclassified sources
- Native host-editor opening for supported content conflicts, including optional Merge Editor and host-specific resolution actions
- An explicitly confirmed **GitAmida: Open in Git Mergetool** editor action when a compatible conflict and configured external tool are available

### Changed

- Count unresolved index paths even when the saved working-tree file matches `HEAD`
- Keep modify/delete conflicts visible while directing their explicit resolution to Source Control

## 0.0.3 - 2026-08-16

### Added

- Changed-files actions to open the current working-tree file and copy its file name or repository-relative path
- Historical Git LFS content resolution for native diffs and external difftools, with exact missing endpoints fetched through cancellable progress without changing the working tree or index
- Compact `Large`, `Submodule`, and `LFS` path tags in Changed files and File History

### Changed

- Replaced abbreviated Git status labels with complete wording separate from content metadata

## 0.0.2 - 2026-08-15

### Changed

- Removed the Marketplace Preview designation after macOS validation and basic Windows smoke testing
- Clarified the current platform validation status
- Pointed the Marketplace homepage to the repository root

## 0.0.1 - 2026-08-15

Initial public preview.

### Added

- Compact Repository History with a commit graph, refs, tags, linked worktree locations, commit details, and saved working-tree changes
- Continuous Range and explicit Selection workflows with explainable per-file Git endpoints
- Multiple File History tabs with rename-aware navigation back to Repository History
- Native text and image comparisons, native fallback for other binary files, and explicit external Git difftool support
- Safety-checked named-branch switching and restoration of one historical file version
