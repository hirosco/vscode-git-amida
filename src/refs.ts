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

export interface CompactBranchRefGroup {
  label: string;
  displayLabel?: string;
  localRefs: CommitRef[];
  remoteRefs: CommitRef[];
  current: boolean;
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

export function compactBranchLabel(ref: CommitRef): string | undefined {
  if (ref.type === "localBranch") {
    return ref.name;
  }
  if (ref.type !== "remoteBranch") {
    return undefined;
  }
  if (ref.symbolicTarget !== undefined) {
    return undefined;
  }
  const separator = ref.name.indexOf("/");
  return separator < 0 || separator === ref.name.length - 1
    ? undefined
    : ref.name.slice(separator + 1);
}

export function compactBranchRefGroups(
  refs: readonly CommitRef[],
  defaults: readonly RemoteDefaultBranch[],
): CompactBranchRefGroup[] {
  const labels: string[] = [];
  const currentBranch = refs.find(
    (ref) => ref.type === "localBranch" && ref.current,
  );
  addUnique(labels, currentBranch?.name);
  for (const ref of refs) {
    addUnique(labels, compactBranchLabel(ref));
  }

  return labels.map((label) => {
    const localRefs = refs.filter(
      (ref) => ref.type === "localBranch" && ref.name === label,
    );
    const remoteRefs = refs.filter(
      (ref) =>
        ref.type === "remoteBranch" &&
        ref.symbolicTarget === undefined &&
        compactBranchLabel(ref) === label,
    );
    const current = localRefs.some((ref) => ref.current);
    const remoteDefault = remoteRefs
      .map((ref) => remoteDefaultLabel(ref, defaults))
      .find((candidate) => candidate !== undefined);
    const displayLabel = current
      ? label
      : remoteDefault ??
        (label === "main" || label === "master" ? label : undefined);
    return {
      label,
      ...(displayLabel === undefined ? {} : { displayLabel }),
      localRefs,
      remoteRefs,
      current,
    };
  });
}

function addUnique(values: string[], value: string | undefined): void {
  if (value !== undefined && !values.includes(value)) {
    values.push(value);
  }
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
