import assert from "node:assert/strict";
import test from "node:test";

import { parseGitWorktrees } from "../src/worktrees";

test("parseGitWorktrees preserves active, detached, locked, and stale records", () => {
  const output = Buffer.from(
    "worktree /repo/main\x00" +
      "HEAD aaa\x00" +
      "branch refs/heads/main\x00\x00" +
      "worktree /repo/detached path\x00" +
      "HEAD bbb\x00" +
      "detached\x00" +
      "locked background task\x00\x00" +
      "worktree /repo/stale\x00" +
      "HEAD ccc\x00" +
      "branch refs/heads/stale\x00" +
      "prunable gitdir file points to non-existent location\x00\x00" +
      "worktree /repo/bare.git\x00" +
      "bare\x00\x00",
  );

  assert.deepEqual(parseGitWorktrees(output), [
    {
      path: "/repo/main",
      head: "aaa",
      branch: "main",
      detached: false,
      bare: false,
      prunable: false,
    },
    {
      path: "/repo/detached path",
      head: "bbb",
      detached: true,
      bare: false,
      prunable: false,
    },
    {
      path: "/repo/stale",
      head: "ccc",
      branch: "stale",
      detached: false,
      bare: false,
      prunable: true,
    },
    {
      path: "/repo/bare.git",
      detached: false,
      bare: true,
      prunable: false,
    },
  ]);
});
