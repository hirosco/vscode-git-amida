import assert from "node:assert/strict";
import test from "node:test";

import { NativeDiffSessionRegistry } from "../src/diffSessions";

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
    originalUri: "git-amida-image:/base/image.png?id=before",
    modifiedUri: "git-amida-image:/tip/image.png?id=after",
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
  assert.equal(registry.getByUri("git-amida-image:/other.png"), undefined);
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
    originalUri: "git-amida-image:/base/image.png?id=before",
    modifiedUri: "git-amida-image:/tip/image.png?id=after",
  };

  registry.register(session);
  assert.equal(registry.removeByUri(session.modifiedUri), session);
  assert.equal(registry.get(session.originalUri, session.modifiedUri), undefined);
  assert.equal(registry.getByUri(session.originalUri), undefined);
  assert.equal(registry.getByUri(session.modifiedUri), undefined);
  assert.equal(registry.removeByUri(session.modifiedUri), undefined);
  assert.equal(changes, 2);
});
