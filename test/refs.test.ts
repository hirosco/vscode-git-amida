import assert from "node:assert/strict";
import test from "node:test";

import type { CommitRef } from "../src/model";
import {
  remoteDefaultBranches,
  remoteDefaultLabel,
} from "../src/refs";

test("remoteDefaultBranches resolves multiple remote symbolic refs", () => {
  const originMain = remoteBranch("origin/main");
  const upstreamDevelop = remoteBranch("upstream/develop");
  const refs = [
    remoteHead("origin", originMain.fullName),
    originMain,
    remoteHead("upstream", upstreamDevelop.fullName),
    upstreamDevelop,
  ];

  const defaults = remoteDefaultBranches(refs);

  assert.deepEqual(defaults, [
    {
      headFullName: "refs/remotes/origin/HEAD",
      remoteName: "origin",
      branchName: "main",
      targetName: "origin/main",
      targetFullName: "refs/remotes/origin/main",
    },
    {
      headFullName: "refs/remotes/upstream/HEAD",
      remoteName: "upstream",
      branchName: "develop",
      targetName: "upstream/develop",
      targetFullName: "refs/remotes/upstream/develop",
    },
  ]);
  assert.equal(remoteDefaultLabel(originMain, defaults), "main");
  assert.equal(remoteDefaultLabel(upstreamDevelop, defaults), "develop");
});

test("remoteDefaultBranches ignores missing and cross-remote targets", () => {
  const refs = [
    remoteHead("origin", "refs/remotes/origin/missing"),
    remoteHead("upstream", "refs/remotes/origin/main"),
    remoteBranch("origin/main"),
    remoteBranch("origin/team/HEAD"),
  ];

  assert.deepEqual(remoteDefaultBranches(refs), []);
});

function remoteBranch(name: string): CommitRef {
  return {
    name,
    fullName: `refs/remotes/${name}`,
    type: "remoteBranch",
    current: false,
  };
}

function remoteHead(remote: string, symbolicTarget: string): CommitRef {
  return {
    name: `${remote}/HEAD`,
    fullName: `refs/remotes/${remote}/HEAD`,
    type: "remoteBranch",
    current: false,
    symbolicTarget,
  };
}
