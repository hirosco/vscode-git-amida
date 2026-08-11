import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import * as vscode from "vscode";

export class GitContentProvider
  implements vscode.TextDocumentContentProvider, vscode.Disposable
{
  private readonly contents = new Map<string, string>();

  public dispose(): void {
    this.contents.clear();
  }

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

  public remove(uri: vscode.Uri): boolean {
    const id = new URLSearchParams(uri.query).get("id");
    return id === null ? false : this.contents.delete(id);
  }
}

interface ImageResource {
  size: number;
  controller: AbortController;
  read: (signal: AbortSignal) => Promise<Uint8Array>;
}

export class GitImageFileSystemProvider
  implements vscode.FileSystemProvider, vscode.Disposable
{
  private readonly resources = new Map<string, ImageResource>();
  private readonly changeEmitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();

  public readonly onDidChangeFile = this.changeEmitter.event;

  public dispose(): void {
    for (const resource of this.resources.values()) {
      resource.controller.abort();
    }
    this.resources.clear();
    this.changeEmitter.dispose();
  }

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public stat(uri: vscode.Uri): vscode.FileStat {
    const resource = this.resource(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: resource.size,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  public readDirectory(): [string, vscode.FileType][] {
    throw vscode.FileSystemError.FileNotADirectory();
  }

  public createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const resource = this.resource(uri);
    return resource.read(resource.controller.signal);
  }

  public writeFile(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  public add(
    path: string,
    label: string,
    size: number,
    read: (signal: AbortSignal) => Promise<Uint8Array>,
  ): vscode.Uri {
    const id = randomUUID();
    this.resources.set(id, { size, controller: new AbortController(), read });
    const fileName = basename(path) || "empty";
    return vscode.Uri.from({
      scheme: "git-amida-image",
      path: `/${label}/${fileName}`,
      query: new URLSearchParams({ id }).toString(),
    });
  }

  public remove(uri: vscode.Uri): boolean {
    const id = new URLSearchParams(uri.query).get("id");
    const resource = id === null ? undefined : this.resources.get(id);
    if (id === null || resource === undefined) {
      return false;
    }
    resource.controller.abort();
    return this.resources.delete(id);
  }

  private resource(uri: vscode.Uri): ImageResource {
    const id = new URLSearchParams(uri.query).get("id");
    const resource = id === null ? undefined : this.resources.get(id);
    if (resource === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return resource;
  }
}
