import assert from "node:assert/strict";
import test from "node:test";

import { GitClient, GitCancellationError } from "../src/git";
import {
  editorGitExecutable,
  type GitExecutableExtension,
} from "../src/gitExecutable";

function fixture(enabled = true) {
  const listeners = new Set<(enabled: boolean) => void>();
  const api = { git: { path: "/custom Git/bin/git" } };
  const exports: GitExecutableExtension & { enabled: boolean } = {
    enabled,
    onDidChangeEnablement(listener) {
      listeners.add(listener);
      return { dispose: () => { listeners.delete(listener); } };
    },
    getAPI(version) {
      assert.equal(version, 1);
      assert.equal(exports.enabled, true);
      return api;
    },
  };
  const handle = {
    isActive: true,
    exports,
    activate: async () => exports,
  };
  return {
    api,
    handle,
    listeners,
    enable() {
      exports.enabled = true;
      for (const listener of listeners) {
        listener(true);
      }
    },
  };
}

test("editor Git uses the detected path verbatim and follows later detection", async () => {
  const state = fixture();
  const executable = editorGitExecutable(state.handle);
  assert.equal(await executable(), "/custom Git/bin/git");
  state.api.git.path = "C:\\Program Files\\Git\\cmd\\git.exe";
  assert.equal(await executable(), state.api.git.path);
  assert.equal(state.listeners.size, 0);
});

test("editor Git waits for activation before accessing exports", async () => {
  const state = fixture();
  let activated = false;
  const executable = editorGitExecutable({
    isActive: false,
    get exports(): GitExecutableExtension {
      throw new Error("Exports are not available before activation");
    },
    async activate() {
      activated = true;
      return state.handle.exports;
    },
  });
  assert.equal(await executable(), state.api.git.path);
  assert.equal(activated, true);
});

test("editor Git waits for detection and disposes the readiness listener", async () => {
  const state = fixture(false);
  const result = editorGitExecutable(state.handle)();
  assert.equal(state.listeners.size, 1);
  state.enable();
  assert.equal(await result, state.api.git.path);
  assert.equal(state.listeners.size, 0);
});

test("unavailable Git reports configuration guidance and can be retried", async () => {
  const state = fixture(false);
  const executable = editorGitExecutable(state.handle, 5);
  await assert.rejects(async () => executable(), /Install Git or configure git\.path/);
  assert.equal(state.listeners.size, 0);
  state.enable();
  assert.equal(await executable(), state.api.git.path);
});

test("missing extension and empty detection never fall back to PATH", async () => {
  await assert.rejects(
    async () => editorGitExecutable(undefined)(),
    /built-in Git extension is unavailable/,
  );
  const state = fixture();
  state.api.git.path = "";
  await assert.rejects(
    async () => editorGitExecutable(state.handle)(),
    /Install Git or configure git\.path/,
  );
});

test("cancelled Git discovery releases its listener without interrupting another request", async () => {
  const state = fixture(false);
  const executable = editorGitExecutable(state.handle);
  const controller = new AbortController();
  const cancelled = new GitClient(undefined, executable).resolveRepository(
    process.cwd(), controller.signal,
  );
  const other = executable();
  assert.equal(state.listeners.size, 2);
  controller.abort();
  await assert.rejects(cancelled, GitCancellationError);
  assert.equal(state.listeners.size, 1);
  state.enable();
  assert.equal(await other, state.api.git.path);
  assert.equal(state.listeners.size, 0);
});
