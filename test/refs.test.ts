import assert from "node:assert/strict";
import test from "node:test";

import type { CommitRef } from "../src/model";
import {
  compactBranchRefGroups,
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

test("compactBranchRefGroups combines a current branch with its same-name remote", () => {
  const upstream = remoteBranch("origin/feature/history");
  const current = localBranch("feature/history", {
    current: true,
  });
  const refs = [current, upstream];

  assert.deepEqual(compactBranchRefGroups(refs, []), [
    {
      label: "feature/history",
      displayLabel: "feature/history",
      localRefs: [current],
      remoteRefs: [upstream],
      current: true,
    },
  ]);
});

test("compactBranchRefGroups combines local and remote primary anchors", () => {
  const localMain = localBranch("main");
  const originMain = remoteBranch("origin/main");
  const upstreamMain = remoteBranch("upstream/main");
  const refs = [localMain, originMain, upstreamMain];

  assert.deepEqual(compactBranchRefGroups(refs, []), [
    {
      label: "main",
      displayLabel: "main",
      localRefs: [localMain],
      remoteRefs: [originMain, upstreamMain],
      current: false,
    },
  ]);
});

test("compactBranchRefGroups combines a remote default with a matching local branch", () => {
  const localDevelop = localBranch("develop");
  const originDevelop = remoteBranch("origin/develop");
  const refs = [
    localDevelop,
    remoteHead("origin", originDevelop.fullName),
    originDevelop,
  ];
  const defaults = remoteDefaultBranches(refs);

  assert.deepEqual(compactBranchRefGroups(refs, defaults), [
    {
      label: "develop",
      displayLabel: "develop",
      localRefs: [localDevelop],
      remoteRefs: [originDevelop],
      current: false,
    },
  ]);
});

test("compactBranchRefGroups separates unlabeled branch groups without losing refs", () => {
  const localTopic = localBranch("topic/grouped");
  const originTopic = remoteBranch("origin/topic/grouped");
  const upstreamTopic = remoteBranch("upstream/topic/grouped");
  const remoteOnly = remoteBranch("origin/topic/remote-only");
  const refs = [localTopic, originTopic, upstreamTopic, remoteOnly];

  assert.deepEqual(compactBranchRefGroups(refs, []), [
    {
      label: "topic/grouped",
      localRefs: [localTopic],
      remoteRefs: [originTopic, upstreamTopic],
      current: false,
    },
    {
      label: "topic/remote-only",
      localRefs: [],
      remoteRefs: [remoteOnly],
      current: false,
    },
  ]);
});

function localBranch(
  name: string,
  values: Partial<CommitRef> = {},
): CommitRef {
  return {
    name,
    fullName: `refs/heads/${name}`,
    type: "localBranch",
    current: false,
    ...values,
  };
}

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
