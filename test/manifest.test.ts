import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

interface MenuContribution {
  command: string;
  group?: string;
  when?: string;
}

interface CommandContribution {
  command: string;
  title: string;
}

interface ExtensionManifest {
  contributes: {
    commands: CommandContribution[];
    menus: Record<string, MenuContribution[]>;
  };
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../package.json"), "utf8"),
) as ExtensionManifest;

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
