import type { ChangedFile, FileTreeDirectory, FileTreeNode } from "./model";

interface MutableDirectory {
  directories: Map<string, MutableDirectory>;
  files: ChangedFile[];
}

export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root: MutableDirectory = { directories: new Map(), files: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let directory = root;
    for (const part of parts.slice(0, -1)) {
      let child = directory.directories.get(part);
      if (child === undefined) {
        child = { directories: new Map(), files: [] };
        directory.directories.set(part, child);
      }
      directory = child;
    }
    directory.files.push(file);
  }

  return materialize(root, "");
}

function materialize(directory: MutableDirectory, parentPath: string): FileTreeNode[] {
  const directories: FileTreeDirectory[] = [...directory.directories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, child]) => {
      const path = parentPath.length > 0 ? `${parentPath}/${name}` : name;
      return {
        kind: "directory",
        name,
        path,
        children: materialize(child, path),
      };
    });
  const files = [...directory.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => ({
      kind: "file" as const,
      name: file.path.split("/").at(-1) ?? file.path,
      path: file.path,
      file,
    }));
  return [...directories, ...files];
}
