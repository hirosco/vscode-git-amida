import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

interface MenuContribution {
  command?: string;
  submenu?: string;
  group?: string;
  when?: string;
}

interface CommandContribution {
  command: string;
  title: string;
  category?: string;
}

interface ColorContribution {
  id: string;
  description: string;
  defaults: Record<string, string>;
}

interface ExtensionManifest {
  contributes: {
    colors: ColorContribution[];
    commands: CommandContribution[];
    submenus: { id: string; label: string }[];
    menus: Record<string, MenuContribution[]>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
) as ExtensionManifest;

test("GitAmida exposes stable semantic colors for HEAD and tags", () => {
  assert.deepEqual(manifest.contributes.colors, [
    {
      id: "gitAmida.headRefColor",
      description: "Color of the GitAmida inline local HEAD indicator.",
      defaults: {
        dark: "#E2C08D",
        light: "#895503",
        highContrast: "#FFD370",
        highContrastLight: "#895503",
      },
    },
    {
      id: "gitAmida.tagRefColor",
      description: "Color of GitAmida tag indicators.",
      defaults: {
        dark: "#8C8C8C",
        light: "#8E8E90",
        highContrast: "#A7A8A9",
        highContrastLight: "#8E8E90",
      },
    },
  ]);
});

test("Explorer files expose the shared File History context action", () => {
  const explorerAction = manifest.contributes.menus["explorer/context"]?.find(
    ({ command }) => command === "gitAmida.openFileHistory",
  );

  assert.deepEqual(explorerAction, {
    command: "gitAmida.openFileHistory",
    when: "resourceScheme == file && !explorerResourceIsFolder",
    group: "git",
  });
  assert.equal(
    manifest.contributes.commands.find(
      ({ command }) => command === "gitAmida.openFileHistory",
    )?.title,
    "GitAmida: Show File History",
  );
});

test("the short context action stays out of the Command Palette", () => {
  const paletteAction = manifest.contributes.menus.commandPalette?.find(
    ({ command }) => command === "gitAmida.openFileHistoryFromChangedFile",
  );

  assert.deepEqual(paletteAction, {
    command: "gitAmida.openFileHistoryFromChangedFile",
    when: "false",
  });
});

test("native diffs identify GitAmida while Changed Files keeps a short action", () => {
  const externalCommand = manifest.contributes.commands.find(
    ({ command }) => command === "gitAmida.openInDifftool",
  );
  const contextCommand = manifest.contributes.commands.find(
    ({ command }) => command === "gitAmida.openInDifftoolFromChangedFile",
  );
  const editorAction = manifest.contributes.menus["editor/title"]?.find(
    ({ command }) => command === "gitAmida.openInDifftool",
  );
  const contextAction = manifest.contributes.menus["webview/context"]?.find(
    ({ command }) => command === "gitAmida.openInDifftoolFromChangedFile",
  );
  const paletteAction = manifest.contributes.menus.commandPalette?.find(
    ({ command }) => command === "gitAmida.openInDifftoolFromChangedFile",
  );

  assert.deepEqual(externalCommand, {
    command: "gitAmida.openInDifftool",
    title: "GitAmida: Open in Git Difftool",
    icon: "$(link-external)",
  });
  assert.deepEqual(contextCommand, {
    command: "gitAmida.openInDifftoolFromChangedFile",
    title: "Open in Git Difftool",
    category: "GitAmida",
  });
  assert.deepEqual(editorAction, {
    command: "gitAmida.openInDifftool",
    when: "resourceScheme =~ /^git-amida$|^git-amida-blob$/",
    group: "navigation@10",
  });
  assert.deepEqual(contextAction, {
    command: "gitAmida.openInDifftoolFromChangedFile",
    when: "webviewId == 'gitAmida.history' && webviewSection == 'changedFile'",
    group: "navigation@4",
  });
  assert.deepEqual(paletteAction, {
    command: "gitAmida.openInDifftoolFromChangedFile",
    when: "false",
  });
});

test("Changed files expose working-tree open and copy actions only in context", () => {
  const contextMenu = manifest.contributes.menus["webview/context"] ?? [];
  const commandPalette = manifest.contributes.menus.commandPalette ?? [];
  const copyMenu = manifest.contributes.menus["gitAmida.copyFile"];

  assert.deepEqual(
    manifest.contributes.commands.find(
      ({ command }) => command === "gitAmida.openChangedFileInWorkingTree",
    ),
    {
      command: "gitAmida.openChangedFileInWorkingTree",
      title: "Open File in Working Tree",
      category: "GitAmida",
    },
  );
  assert.deepEqual(
    contextMenu.find(
      ({ command }) => command === "gitAmida.openChangedFileInWorkingTree",
    ),
    {
      command: "gitAmida.openChangedFileInWorkingTree",
      when: "webviewId == 'gitAmida.history' && webviewSection == 'changedFile'",
      group: "navigation@2",
    },
  );
  assert.deepEqual(
    manifest.contributes.submenus.find(({ id }) => id === "gitAmida.copyFile"),
    { id: "gitAmida.copyFile", label: "Copy" },
  );
  assert.deepEqual(
    contextMenu.find(({ submenu }) => submenu === "gitAmida.copyFile"),
    {
      submenu: "gitAmida.copyFile",
      when: "webviewId == 'gitAmida.history' && webviewSection == 'changedFile'",
      group: "navigation@5",
    },
  );
  assert.deepEqual(copyMenu, [
    {
      command: "gitAmida.copyChangedFileName",
      group: "navigation@1",
    },
    {
      command: "gitAmida.copyChangedFileRelativePath",
      group: "navigation@2",
    },
  ]);
  for (const command of [
    "gitAmida.openChangedFileInWorkingTree",
    "gitAmida.copyChangedFileName",
    "gitAmida.copyChangedFileRelativePath",
  ]) {
    assert.deepEqual(
      commandPalette.find((entry) => entry.command === command),
      { command, when: "false" },
    );
  }
});

test("File History revisions expose only the context reveal action", () => {
  const contextAction = manifest.contributes.menus["webview/context"]?.find(
    ({ command }) => command === "gitAmida.showInRepositoryHistory",
  );
  const paletteAction = manifest.contributes.menus.commandPalette?.find(
    ({ command }) => command === "gitAmida.showInRepositoryHistory",
  );

  assert.deepEqual(contextAction, {
    command: "gitAmida.showInRepositoryHistory",
    when: "webviewId == 'gitAmida.history' && webviewSection == 'fileRevision'",
    group: "navigation",
  });
  assert.deepEqual(paletteAction, {
    command: "gitAmida.showInRepositoryHistory",
    when: "false",
  });
  assert.equal(
    manifest.contributes.commands.find(
      ({ command }) => command === "gitAmida.showInRepositoryHistory",
    )?.title,
    "Show in Repository History",
  );
});
