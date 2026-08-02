import type { CommitRef } from "./model";

const REMOTE_REF_PREFIX = "refs/remotes/";
const REMOTE_HEAD_SUFFIX = "/HEAD";

export interface RemoteDefaultBranch {
  headFullName: string;
  remoteName: string;
  branchName: string;
  targetName: string;
  targetFullName: string;
}

export function remoteDefaultBranches(
  refs: readonly CommitRef[],
): RemoteDefaultBranch[] {
  const refsByFullName = new Map(refs.map((ref) => [ref.fullName, ref]));
  const defaults: RemoteDefaultBranch[] = [];

  for (const ref of refs) {
    const relationship = remoteDefaultBranch(ref, refsByFullName);
    if (relationship !== undefined) {
      defaults.push(relationship);
    }
  }

  return defaults.sort(
    (left, right) =>
      left.remoteName.localeCompare(right.remoteName) ||
      left.branchName.localeCompare(right.branchName),
  );
}

export function remoteDefaultLabel(
  ref: CommitRef,
  defaults: readonly RemoteDefaultBranch[],
): string | undefined {
  return defaults.find((candidate) => candidate.targetFullName === ref.fullName)
    ?.branchName;
}

function remoteDefaultBranch(
  ref: CommitRef,
  refsByFullName: ReadonlyMap<string, CommitRef>,
): RemoteDefaultBranch | undefined {
  if (
    ref.type !== "remoteBranch" ||
    !ref.fullName.startsWith(REMOTE_REF_PREFIX) ||
    !ref.fullName.endsWith(REMOTE_HEAD_SUFFIX) ||
    ref.symbolicTarget === undefined
  ) {
    return undefined;
  }

  const remoteName = ref.fullName.slice(
    REMOTE_REF_PREFIX.length,
    -REMOTE_HEAD_SUFFIX.length,
  );
  const targetPrefix = `${REMOTE_REF_PREFIX}${remoteName}/`;
  if (!ref.symbolicTarget.startsWith(targetPrefix)) {
    return undefined;
  }

  const branchName = ref.symbolicTarget.slice(targetPrefix.length);
  const target = refsByFullName.get(ref.symbolicTarget);
  if (
    branchName.length === 0 ||
    target === undefined ||
    target.type !== "remoteBranch"
  ) {
    return undefined;
  }

  return {
    headFullName: ref.fullName,
    remoteName,
    branchName,
    targetName: target.name,
    targetFullName: target.fullName,
  };
}
