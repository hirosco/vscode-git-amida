# GitAmida Roadmap

GitAmida is functionally complete for its current scope. The following items are the only planned additions and are priorities rather than release commitments.

## Changed-file working-tree access and copying

- Open the exact current working-tree file from a Changed-files row
- Copy its file name or repository-relative path
- Keep renamed and missing files explicit instead of guessing another destination

This work should make common follow-up actions available without changing existing diff navigation.

## Historical Git LFS content

- Resolve Git LFS pointers at selected historical endpoints for native diffs and external difftools
- Prefer already available local LFS objects and request explicit user action before any network download
- Fetch only the selected file and revision without changing the working tree or index

Repository-wide LFS downloads, image editing, and automatic write-back are outside this scope.
