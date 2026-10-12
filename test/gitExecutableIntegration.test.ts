import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("all Git services work with a detected executable outside PATH", {
  skip: process.platform === "win32" ? "The fixture uses a POSIX executable symlink" : false,
}, (context) => {
  const root = mkdtempSync(join(tmpdir(), "git-amida-executable-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  const installation = join(root, "Git installation with spaces");
  mkdirSync(installation);
  const executable = join(installation, "git");
  symlinkSync(join(execPath, "git"), executable);
  const repository = join(root, "repository");
  mkdirSync(repository);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: join(root, "no-global-config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "0",
  };
  const git = (...args: string[]): string => execFileSync(executable, ["-C", repository, ...args], {
    encoding: "utf8", env,
  }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "GitAmida Test");
  git("config", "user.email", "gitamida@example.invalid");
  writeFileSync(join(repository, "file.txt"), "before\n");
  git("add", "--", "file.txt");
  git("commit", "-q", "-m", "first");
  const before = git("rev-parse", "HEAD");
  git("branch", "target");
  writeFileSync(join(repository, "file.txt"), "after\n");
  git("commit", "-q", "-am", "second");
  git("config", "merge.tool", "test-tool");

  // Run in a separate process so removing PATH cannot affect concurrent tests.
  const script = `
    const assert = require('node:assert/strict');
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const { execFileSync } = require('node:child_process');
    const { GitClient } = require('./git');
    const { BranchMutationService } = require('./branchSwitcher');
    const { FileRestoreService } = require('./fileRestorer');
    const { ExternalDifftoolService } = require('./externalDifftool');
    const { ExternalMergetoolService } = require('./externalMergetool');
    const { editorGitExecutable } = require('./gitExecutable');
    const [path, repository, before] = process.argv.slice(1);
    const executable = editorGitExecutable({
      isActive: true,
      exports: { enabled: true, getAPI: () => ({git: {path}}) },
    });
    (async () => {
      assert.throws(() => execFileSync('git', ['--version']), { code: 'ENOENT' });
      const client = new GitClient(undefined, executable);
      const history = await client.loadHistory(repository);
      assert.equal(history.rows.length, 2);
      const revisions = await client.fileHistory(repository, 'file.txt');
      assert.equal(revisions.length, 2);
      assert.equal((await client.readBlob(repository, before, 'file.txt')).toString(), 'before\\n');
      const mutations = new BranchMutationService(executable);
      await mutations.switchBranch(repository, 'target', before, []);
      assert.equal((await client.loadHistory(repository)).repository.branch, 'target');
      const latest = history.rows[0].commit.hash;
      await new FileRestoreService(executable).restore({
        repository, sourceRef: latest, sourcePath: 'file.txt', destinationPath: 'file.txt',
      });
      assert.equal(readFileSync(join(repository, 'file.txt'), 'utf8'), 'after\\n');
      assert.equal(execFileSync(path, ['-C', repository, 'diff', '--cached', '--name-only']).toString(), '');
      assert.deepEqual(await new ExternalMergetoolService(undefined, executable).configuredTool(repository), {
        name: 'test-tool', gui: false,
      });
      execFileSync(path, ['-C', repository, 'config', '--unset', 'merge.tool']);
      const diff = new ExternalDifftoolService(undefined, executable);
      try {
        await assert.rejects(diff.open({
          repository, beforePath: 'file.txt', afterPath: 'file.txt',
          beforeContent: Buffer.from('before'), afterContent: Buffer.from('after'),
        }), /No Git diff tool is configured/);
      } finally { diff.dispose(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ["-e", script, executable, repository, before], {
    cwd: resolve(__dirname, "../src"),
    env: { ...env, PATH: join(root, "no-path"), GIT_EXEC_PATH: execPath },
    timeout: 30_000,
    stdio: "pipe",
  }));
});
