import * as vscode from "vscode";

interface GitRef {
  type: number;
  name?: string;
  commit?: string;
}

interface GitRepositoryState {
  HEAD?: GitRef;
  refs: GitRef[];
  onDidChange: vscode.Event<void>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

export async function observeGitRepositories(
  subscriptions: vscode.Disposable[],
  onChange: (
    repository: string,
    scope: "workingTree" | "history",
  ) => void,
): Promise<void> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>(
    "vscode.git",
  );
  if (extension === undefined) {
    return;
  }
  const exports = extension.isActive
    ? extension.exports
    : await extension.activate();
  const api = exports.getAPI(1);
  const repositorySubscriptions = new Map<string, vscode.Disposable>();

  const observe = (repository: GitRepository): void => {
    const key = repository.rootUri.toString();
    repositorySubscriptions.get(key)?.dispose();
    let fingerprint = historyFingerprint(repository.state);
    repositorySubscriptions.set(
      key,
      repository.state.onDidChange(() => {
        const nextFingerprint = historyFingerprint(repository.state);
        const scope =
          nextFingerprint === fingerprint ? "workingTree" : "history";
        fingerprint = nextFingerprint;
        onChange(repository.rootUri.fsPath, scope);
      }),
    );
  };
  const stopObserving = (repository: GitRepository): void => {
    const key = repository.rootUri.toString();
    repositorySubscriptions.get(key)?.dispose();
    repositorySubscriptions.delete(key);
  };

  for (const repository of api.repositories) {
    observe(repository);
  }
  subscriptions.push(
    api.onDidOpenRepository(observe),
    api.onDidCloseRepository(stopObserving),
    new vscode.Disposable(() => {
      for (const disposable of repositorySubscriptions.values()) {
        disposable.dispose();
      }
      repositorySubscriptions.clear();
    }),
  );
}

function historyFingerprint(state: GitRepositoryState): string {
  const head = state.HEAD;
  const refs = state.refs
    .map((ref) => `${ref.type}:${ref.name ?? ""}:${ref.commit ?? ""}`)
    .sort();
  return [
    `${head?.type ?? ""}:${head?.name ?? ""}:${head?.commit ?? ""}`,
    ...refs,
  ].join("\x00");
}
