export interface NativeDiffSession {
  repository: string;
  beforePath: string;
  afterPath: string;
  originalUri: string;
  modifiedUri: string;
}

export type NativeDiffTabIdentity =
  | {
      kind: "diff";
      originalUri: string;
      modifiedUri: string;
    }
  | {
      kind: "resource";
      uri: string;
    };

export class NativeDiffSessionRegistry {
  private readonly sessions = new Map<string, NativeDiffSession>();
  private readonly sessionsByUri = new Map<string, NativeDiffSession>();
  private readonly listeners = new Set<() => void>();

  public register(session: NativeDiffSession): void {
    this.sessions.set(
      sessionKey(session.originalUri, session.modifiedUri),
      session,
    );
    this.sessionsByUri.set(session.originalUri, session);
    this.sessionsByUri.set(session.modifiedUri, session);
    this.notify();
  }

  public get(
    originalUri: string,
    modifiedUri: string,
  ): NativeDiffSession | undefined {
    return this.sessions.get(sessionKey(originalUri, modifiedUri));
  }

  public getByUri(uri: string): NativeDiffSession | undefined {
    return this.sessionsByUri.get(uri);
  }

  public getForTab(
    tab: NativeDiffTabIdentity,
  ): NativeDiffSession | undefined {
    return tab.kind === "diff"
      ? this.get(tab.originalUri, tab.modifiedUri)
      : this.getByUri(tab.uri);
  }

  public remove(
    originalUri: string,
    modifiedUri: string,
  ): NativeDiffSession | undefined {
    const session = this.get(originalUri, modifiedUri);
    if (session !== undefined) {
      this.removeSession(session);
    }
    return session;
  }

  public removeByUri(uri: string): NativeDiffSession | undefined {
    const session = this.getByUri(uri);
    if (session !== undefined) {
      this.removeSession(session);
    }
    return session;
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    this.sessions.clear();
    this.sessionsByUri.clear();
    this.listeners.clear();
  }

  private removeSession(session: NativeDiffSession): void {
    this.sessions.delete(sessionKey(session.originalUri, session.modifiedUri));
    if (this.sessionsByUri.get(session.originalUri) === session) {
      this.sessionsByUri.delete(session.originalUri);
    }
    if (this.sessionsByUri.get(session.modifiedUri) === session) {
      this.sessionsByUri.delete(session.modifiedUri);
    }
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function sessionKey(originalUri: string, modifiedUri: string): string {
  return JSON.stringify([originalUri, modifiedUri]);
}

export function isNativeDiffSessionOpen(
  session: NativeDiffSession,
  tabs: readonly NativeDiffTabIdentity[],
): boolean {
  return tabs.some((tab) =>
    tab.kind === "diff"
      ? tab.originalUri === session.originalUri &&
        tab.modifiedUri === session.modifiedUri
      : tab.uri === session.originalUri || tab.uri === session.modifiedUri,
  );
}
