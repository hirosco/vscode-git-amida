import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import * as vscode from "vscode";

export class GitContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const id = new URLSearchParams(uri.query).get("id");
    if (id === null) {
      return "";
    }
    return this.contents.get(id) ?? "";
  }

  public add(path: string, label: string, content: string): vscode.Uri {
    const id = randomUUID();
    this.contents.set(id, content);
    const fileName = basename(path) || "empty";
    return vscode.Uri.from({
      scheme: "git-amida",
      path: `/${label}/${fileName}`,
      query: new URLSearchParams({ id }).toString(),
    });
  }
}
