import assert from "node:assert/strict";
import test from "node:test";

import {
  isNativeDiffSessionOpen,
  NativeDiffSessionRegistry,
} from "../src/diffSessions";

test("NativeDiffSessionRegistry keeps comparisons tied to both editor URIs", () => {
  const registry = new NativeDiffSessionRegistry();
  let registrations = 0;
  const unregister = registry.onDidChange(() => {
    registrations += 1;
  });
  const session = {
    repository: "/repository",
    beforePath: "old/image.png",
    afterPath: "new/image.png",
    originalUri: "git-amida-blob:/base/image.png?id=before",
    modifiedUri: "git-amida-blob:/tip/image.png?id=after",
  };

  registry.register(session);
  unregister();
  registry.register(session);

  assert.equal(registrations, 1);
  assert.equal(
    registry.get(session.originalUri, session.modifiedUri),
    session,
  );
  assert.equal(
    registry.get(session.modifiedUri, session.originalUri),
    undefined,
  );
  assert.equal(registry.getByUri(session.originalUri), session);
  assert.equal(registry.getByUri(session.modifiedUri), session);
  assert.equal(registry.getByUri("git-amida-blob:/other.png"), undefined);
});

test("NativeDiffSessionRegistry releases a comparison by either URI", () => {
  const registry = new NativeDiffSessionRegistry();
  let changes = 0;
  registry.onDidChange(() => {
    changes += 1;
  });
  const session = {
    repository: "/repository",
    beforePath: "old/image.png",
    afterPath: "new/image.png",
    originalUri: "git-amida-blob:/base/image.png?id=before",
    modifiedUri: "git-amida-blob:/tip/image.png?id=after",
  };

  registry.register(session);
  assert.equal(registry.removeByUri(session.modifiedUri), session);
  assert.equal(registry.get(session.originalUri, session.modifiedUri), undefined);
  assert.equal(registry.getByUri(session.originalUri), undefined);
  assert.equal(registry.getByUri(session.modifiedUri), undefined);
  assert.equal(registry.removeByUri(session.modifiedUri), undefined);
  assert.equal(changes, 2);
});

test("binary fallback replacement keeps the same native diff session open", () => {
  const registry = new NativeDiffSessionRegistry();
  const session = {
    repository: "/repository",
    beforePath: "archive.bin",
    afterPath: "archive.bin",
    originalUri: "git-amida-blob:/base/archive.bin?id=before",
    modifiedUri: "git-amida-blob:/tip/archive.bin?id=after",
  };
  registry.register(session);

  const replacement = {
    kind: "diff" as const,
    originalUri: session.originalUri,
    modifiedUri: session.modifiedUri,
  };
  assert.equal(registry.getForTab(replacement), session);
  assert.equal(isNativeDiffSessionOpen(session, [replacement]), true);
  assert.equal(isNativeDiffSessionOpen(session, []), false);
});

test("custom image editor keeps a native diff session open by either endpoint", () => {
  const session = {
    repository: "/repository",
    beforePath: "old/image.png",
    afterPath: "new/image.png",
    originalUri: "git-amida-blob:/base/image.png?id=before",
    modifiedUri: "git-amida-blob:/tip/image.png?id=after",
  };

  assert.equal(
    isNativeDiffSessionOpen(session, [
      { kind: "resource", uri: session.modifiedUri },
    ]),
    true,
  );
  assert.equal(
    isNativeDiffSessionOpen(session, [
      { kind: "resource", uri: "git-amida-blob:/other/image.png" },
    ]),
    false,
  );
});
