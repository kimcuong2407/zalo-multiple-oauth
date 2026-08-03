import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MessageStore } from "../message-store.js";

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-message-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function message(index, overrides = {}) {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    type: "direct",
    threadId: "thread-1",
    senderId: "sender-1",
    text: `message ${index}`,
    msgId: `msg-${index}`,
    ts: index,
    ...overrides,
  };
}

test("retains more than 5,000 messages across reopen", (t) => {
  const dataDir = temporaryDirectory(t);
  let store = new MessageStore({ dataDir });

  const insertAll = store.db.transaction(() => {
    for (let i = 0; i < 5100; i++) store.insertMessage("personal", message(i));
  });
  insertAll();

  assert.equal(store.countMessages("personal"), 5100);
  assert.equal(store.listMessages("personal", { limit: 500 }).length, 500);
  store.close();

  store = new MessageStore({ dataDir });
  t.after(() => store.close());
  assert.equal(store.countMessages("personal"), 5100);
  assert.equal(store.listMessages("personal", { limit: 2 })[0].msgId, "msg-5098");
});

test("deduplicates identified messages per account and retains no-ID messages", (t) => {
  const store = new MessageStore({ dataDir: temporaryDirectory(t) });
  t.after(() => store.close());

  assert.equal(store.insertMessage("a", message(1)).inserted, true);
  assert.equal(store.insertMessage("a", message(1, { text: "duplicate" })).inserted, false);
  assert.equal(store.insertMessage("b", message(1)).inserted, true);
  assert.equal(store.insertMessage("a", message(2, { msgId: null })).inserted, true);
  assert.equal(store.insertMessage("a", message(2, { msgId: null })).inserted, true);

  assert.equal(store.countMessages("a"), 3);
  assert.equal(store.countMessages("b"), 1);
});

test("filters strictly by timestamp and finds oldest cursor per type", (t) => {
  const store = new MessageStore({ dataDir: temporaryDirectory(t) });
  t.after(() => store.close());

  store.insertMessage("a", message(1, { type: "direct", msgId: "d-new", ts: 20 }));
  store.insertMessage("a", message(2, { type: "direct", msgId: "d-old", ts: 10 }));
  store.insertMessage("a", message(3, { type: "group", msgId: "g-old", ts: 5 }));

  const since = message(1).timestamp;
  assert.deepEqual(
    store.listMessages("a", { since, limit: 10 }).map((row) => row.msgId),
    ["d-old", "g-old"],
  );
  assert.deepEqual(store.listMessages("a", { since: "invalid", limit: 10 }), []);
  assert.equal(store.findOldestMessageId("a", "direct"), "d-old");
  assert.equal(store.findOldestMessageId("a", "group"), "g-old");
});

test("migrates legacy JSON once without modifying source or dropping duplicates", (t) => {
  const dataDir = temporaryDirectory(t);
  const legacyDir = path.join(dataDir, "messages");
  fs.mkdirSync(legacyDir);
  const sourcePath = path.join(legacyDir, "personal.json");
  const sourceMessages = [
    message(1, { raw: { content: "raw" }, historical: true }),
    message(1, { text: "legacy duplicate", synced: true }),
    message(2, { msgId: null }),
  ];
  const source = JSON.stringify(sourceMessages, null, 2);
  fs.writeFileSync(sourcePath, source);

  let store = new MessageStore({ dataDir, logger: { log() {}, warn() {} } });
  assert.equal(store.countMessages("personal"), 3);
  assert.deepEqual(store.listMessages("personal", { limit: 10 }), sourceMessages);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), source);
  store.close();

  store = new MessageStore({ dataDir, logger: { log() {}, warn() {} } });
  t.after(() => store.close());
  assert.equal(store.countMessages("personal"), 3);
  assert.equal(store.insertMessage("personal", message(1)).inserted, false);
});

test("rolls back malformed legacy data", (t) => {
  const dataDir = temporaryDirectory(t);
  const legacyDir = path.join(dataDir, "messages");
  fs.mkdirSync(legacyDir);
  const sourcePath = path.join(legacyDir, "broken.json");
  fs.writeFileSync(sourcePath, JSON.stringify([message(1), null]));

  assert.throws(
    () => new MessageStore({ dataDir, logger: { log() {}, warn() {} } }),
    /Invalid message record/,
  );

  fs.unlinkSync(sourcePath);
  const store = new MessageStore({ dataDir, logger: { log() {}, warn() {} } });
  assert.equal(store.countMessages("broken"), 0);
  store.close();
});
