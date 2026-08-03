import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createMessageRouter } from "../message-routes.js";
import { MessageStore } from "../message-store.js";

async function withServer(t, accounts = [{ id: "personal" }]) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-message-api-"));
  const store = new MessageStore({ dataDir });
  const app = express();
  app.use(createMessageRouter({
    accountManager: { list: () => accounts },
    messageStore: store,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  t.after(() => new Promise((resolve) => {
    server.close(() => {
      store.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
      resolve();
    });
  }));

  return {
    store,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

test("per-account messages preserve response shape and cap responses at 500", async (t) => {
  const { store, baseUrl } = await withServer(t);
  const insertAll = store.db.transaction(() => {
    for (let i = 0; i < 550; i++) {
      store.insertMessage("personal", {
        timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        text: `message ${i}`,
        msgId: `msg-${i}`,
      });
    }
  });
  insertAll();

  const response = await fetch(`${baseUrl}/accounts/personal/messages?limit=9999`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.accountId, "personal");
  assert.equal(body.count, 500);
  assert.equal(body.messages.length, 500);
  assert.equal(store.countMessages("personal"), 550);
});

test("all-messages response stays keyed by visible accounts", async (t) => {
  const { store, baseUrl } = await withServer(t, [{ id: "one" }, { id: "empty" }]);
  store.insertMessage("one", {
    timestamp: "2026-01-01T00:00:00.000Z",
    text: "hello",
    msgId: "one-message",
  });
  store.insertMessage("hidden", {
    timestamp: "2026-01-01T00:00:00.000Z",
    text: "hidden",
    msgId: "hidden-message",
  });

  const response = await fetch(`${baseUrl}/messages`);
  assert.deepEqual(await response.json(), {
    one: [{
      timestamp: "2026-01-01T00:00:00.000Z",
      text: "hello",
      msgId: "one-message",
    }],
  });
});
