export type GitExecutable = (signal?: AbortSignal) => string | Promise<string>;

// Standalone adapters and fixture scripts can use the command-line environment.
// The Extension Host always supplies the editor's detected executable instead.
export const gitFromPath: GitExecutable = () => "git";

export interface GitExecutableExtension {
  readonly enabled: boolean;
  onDidChangeEnablement(listener: (enabled: boolean) => void): { dispose(): void };
  getAPI(version: 1): { readonly git: { readonly path: string } };
}

interface GitExtensionHandle {
  readonly isActive: boolean;
  readonly exports: GitExecutableExtension;
  activate(): PromiseLike<GitExecutableExtension>;
}

const GIT_UNAVAILABLE =
  "The editor has not detected Git. Install Git or configure git.path in User Settings, ensure Git is enabled, then reload the window.";

export function editorGitExecutable(
  extension: GitExtensionHandle | undefined,
  timeoutMs = 10_000,
): GitExecutable {
  return async (signal) => {
    signal?.throwIfAborted();
    if (extension === undefined) {
      throw new Error(
        "The editor's built-in Git extension is unavailable. Enable it and reload the window.",
      );
    }
    const exports = extension.isActive
      ? extension.exports
      : await extension.activate();
    await waitForGitExtension(exports, signal, timeoutMs);
    signal?.throwIfAborted();
    const path = exports.getAPI(1).git.path;
    if (path.trim() === "") {
      throw new Error(GIT_UNAVAILABLE);
    }
    return path;
  };
}

export async function waitForGitExtension(
  extension: GitExecutableExtension,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<void> {
  signal?.throwIfAborted();
  if (extension.enabled) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const subscription = extension.onDidChangeEnablement((enabled) => {
      if (enabled) {
        finish();
      }
    });
    const timer = setTimeout(() => finish(new Error(GIT_UNAVAILABLE)), timeoutMs);
    const abort = (): void => finish(signal?.reason);
    const finish = (error?: unknown): void => {
      clearTimeout(timer);
      subscription.dispose();
      signal?.removeEventListener("abort", abort);
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    } else if (extension.enabled) {
      finish();
    }
  });
}
