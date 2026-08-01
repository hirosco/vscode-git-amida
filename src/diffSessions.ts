export interface NativeDiffSession {
  repository: string;
  beforePath: string;
  afterPath: string;
  originalUri: string;
  modifiedUri: string;
}

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
    for (const listener of this.listeners) {
      listener();
    }
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

  public onDidRegister(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sessionKey(originalUri: string, modifiedUri: string): string {
  return JSON.stringify([originalUri, modifiedUri]);
}
