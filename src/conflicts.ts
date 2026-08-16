import type { ConflictStatus, FileConflict } from "./model";

export interface UnmergedIndexStage {
  mode: string;
  object: string;
  stage: 1 | 2 | 3;
}

export interface UnmergedIndexEntry {
  path: string;
  stages: ReadonlyMap<1 | 2 | 3, UnmergedIndexStage>;
  conflict: FileConflict;
}

const CONFLICT_LABELS: Record<ConflictStatus, string> = {
  AA: "Both added",
  AU: "Added by us",
  DD: "Both deleted",
  DU: "Deleted by us",
  UA: "Added by them",
  UD: "Deleted by them",
  UU: "Both modified",
};

const CONFLICT_STATUS_BY_STAGES: Record<string, ConflictStatus> = {
  "1": "DD",
  "2": "AU",
  "3": "UA",
  "1,2": "UD",
  "1,3": "DU",
  "2,3": "AA",
  "1,2,3": "UU",
};

export function parseUnmergedIndex(output: Uint8Array): UnmergedIndexEntry[] {
  const entries = new Map<string, Map<1 | 2 | 3, UnmergedIndexStage>>();
  for (const record of new TextDecoder().decode(output).split("\x00")) {
    if (record === "") {
      continue;
    }
    const separator = record.indexOf("\t");
    if (separator === -1) {
      continue;
    }
    const metadata = record.slice(0, separator).split(" ");
    const [mode, object, rawStage] = metadata;
    const stage = Number(rawStage);
    if (
      metadata.length !== 3 ||
      mode === undefined ||
      !/^[0-7]{6}$/.test(mode) ||
      object === undefined ||
      !/^[0-9a-f]+$/.test(object) ||
      (stage !== 1 && stage !== 2 && stage !== 3)
    ) {
      continue;
    }
    const path = record.slice(separator + 1);
    if (path === "") {
      continue;
    }
    const stages = entries.get(path) ?? new Map();
    stages.set(stage, { mode, object, stage });
    entries.set(path, stages);
  }

  return [...entries].flatMap(([path, stages]) => {
    const key = [...stages.keys()].sort().join(",");
    const status = CONFLICT_STATUS_BY_STAGES[key];
    return status === undefined
      ? []
      : [{ path, stages, conflict: { status } }];
  });
}

export function conflictStatusLabel(conflict: FileConflict): string {
  return CONFLICT_LABELS[conflict.status];
}

export function conflictSupportsMergetool(conflict: FileConflict): boolean {
  return conflict.status === "AA" || conflict.status === "UU";
}
