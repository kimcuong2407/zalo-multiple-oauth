// server.js — HTTP API for zalo-multi-bridge.
// Exposes REST endpoints to read messages from ALL connected Zalo accounts.

import express from "express";
import { manager } from "./accounts.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.ZALO_MULTI_PORT || "8786", 10);
const HOST = process.env.ZALO_MULTI_HOST || "127.0.0.1";

const app = express();
app.use(express.json());

// ── Message store (persistent JSON files + in-memory cache) ──
const DATA_DIR = process.env.ZALO_MULTI_DATA_DIR || path.join(os.homedir(), ".zalo-multi-bridge");
const MSG_DIR = path.join(DATA_DIR, "messages");
if (!fs.existsSync(MSG_DIR)) fs.mkdirSync(MSG_DIR, { recursive: true });

function msgPath(accountId) { return path.join(MSG_DIR, `${accountId}.json`); }

function loadMessages(accountId) {
  const p = msgPath(accountId);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return []; }
  }
  return [];
}

function saveMessages(accountId, msgs) {
  // Keep last 5000 messages
  const toSave = msgs.slice(-5000);
  fs.writeFileSync(msgPath(accountId), JSON.stringify(toSave, null, 2));
  return toSave;
}

const messageStore = new Map(); // accountId -> Array<msg>

function bufferMsg(accountId, msg) {
  let msgs = messageStore.get(accountId);
  if (!msgs) {
    msgs = loadMessages(accountId);
    messageStore.set(accountId, msgs);
  }
  // Deduplicate by msgId
  const exists = msg.msgId && msgs.some(m => m.msgId === msg.msgId);
  if (!exists) {
    msgs.push({ timestamp: new Date().toISOString(), ...msg });
  }
  // Save to disk periodically (every 50 messages)
  if (msgs.length % 50 === 0) saveMessages(accountId, msgs);
}

// Auto-save all on shutdown
process.on("SIGINT", () => {
  for (const [accountId, msgs] of messageStore) saveMessages(accountId, msgs);
  process.exit(0);
});
process.on("SIGTERM", () => {
  for (const [accountId, msgs] of messageStore) saveMessages(accountId, msgs);
});

// Listen for messages
manager.on("message", ({ accountId, ownId, message }) => {
  const data = message.data || {};
  bufferMsg(accountId, {
    type: "direct",
    threadId: data.uidFrom === ownId ? data.idTo : data.uidFrom,
    senderId: data.uidFrom,
    senderName: data.dName || null,
    text: typeof data.content === "string" ? data.content : JSON.stringify(data.content),
    msgId: data.msgId || data.cliMsgId,
    ts: data.ts,
    raw: data,
  });
});

manager.on("group_message", ({ accountId, ownId, message }) => {
  const data = message.data || {};
  bufferMsg(accountId, {
    type: "group",
    threadId: data.idTo,
    groupId: data.idTo,
    senderId: data.uidFrom,
    senderName: data.dName || null,
    groupName: data.groupName || null,
    text: typeof data.content === "string" ? data.content : JSON.stringify(data.content),
    msgId: data.msgId || data.cliMsgId,
    ts: data.ts,
    raw: data,
  });
});

// ── Historical backfill (WebSocket) ──
// Tracks how many messages each requestOldMessages() call produced, so the
// HTTP endpoint can report a real count instead of guessing.
const backfillTally = new Map(); // accountId -> { direct: n, group: n }

function tally(accountId, kind, n) {
  if (!backfillTally.has(accountId)) backfillTally.set(accountId, { direct: 0, group: 0 });
  backfillTally.get(accountId)[kind] += n;
}

function storeOldMessages(accountId, ownId, messages, isGroup) {
  // Load from disk first: comparing against an unloaded store counts every
  // already-seen message as new.
  if (!messageStore.has(accountId)) messageStore.set(accountId, loadMessages(accountId));

  let added = 0;
  for (const message of messages) {
    const data = message.data || message || {};
    if (!data.content) continue;
    const before = messageStore.get(accountId).length;
    bufferMsg(accountId, {
      type: isGroup ? "group" : "direct",
      threadId: isGroup ? data.idTo : (data.uidFrom === ownId ? data.idTo : data.uidFrom),
      ...(isGroup ? { groupId: data.idTo, groupName: data.groupName || null } : {}),
      senderId: data.uidFrom,
      senderName: data.dName || null,
      text: typeof data.content === "string" ? data.content : JSON.stringify(data.content),
      msgId: data.msgId || data.cliMsgId,
      ts: data.ts,
      historical: true,
      raw: data,
    });
    if (messageStore.get(accountId).length > before) added++;
  }
  if (added > 0) saveMessages(accountId, messageStore.get(accountId));
  tally(accountId, isGroup ? "group" : "direct", added);
  console.log(`[backfill:${accountId}] ${isGroup ? "group" : "direct"}: +${added} of ${messages.length}`);
}

manager.on("old_messages", ({ accountId, ownId, messages }) => {
  storeOldMessages(accountId, ownId, messages, false);
});

manager.on("old_group_messages", ({ accountId, ownId, messages }) => {
  storeOldMessages(accountId, ownId, messages, true);
});

// ── Health ──
app.get("/health", (_req, res) => {
  res.json({ ok: true, accounts: manager.list() });
});

// ── Accounts list / detail ──
app.get("/accounts", (_req, res) => {
  res.json(manager.list());
});

app.get("/accounts/:id", (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) {
    const info = manager.list().find(a => a.id === id);
    if (!info) return res.status(404).json({ error: "Account not found" });
    return res.json(info);
  }
  res.json({
    id,
    active: true,
    ownId: acc.ownId,
    displayName: acc.displayName,
  });
});

// ── Login / Logout ──
app.post("/accounts/:id/login", (req, res) => {
  const { id } = req.params;

  if (manager.isLoggedIn(id)) {
    return res.json({ ok: true, message: "Already logged in" });
  }

  // Fire-and-forget: returns immediately, QR will appear at /qr/:id/view
  manager.login(id).then((result) => {
    console.log(`[api] ${id} login OK: ${result?.displayName || result?.ownId}`);
  }).catch((e) => {
    console.log(`[api] ${id} login FAIL: ${e.message}`);
  });

  res.json({ ok: true, message: "Login started — scan QR at /qr/" + id + "/view" });
});

app.post("/accounts/:id/logout", async (req, res) => {
  const { id } = req.params;
  await manager.logout(id);
  res.json({ ok: true });
});

// ── Auto-login all accounts with saved credentials ──
app.post("/accounts/login-all", async (req, res) => {
  const accounts = manager.list().filter(a => a.hasCredentials && !a.active);
  const results = {};

  for (const acc of accounts) {
    try {
      const result = await manager.login(acc.id);
      results[acc.id] = { ok: true, ...result };
    } catch (e) {
      results[acc.id] = { ok: false, error: e.message };
    }
  }

  res.json({ ok: true, results });
});

// ── Messages (from persistent store) ──
app.get("/accounts/:id/messages", (req, res) => {
  const { id } = req.params;
  const { since, limit = "50" } = req.query;
  let msgs = messageStore.get(id) || loadMessages(id);

  if (since) {
    const sinceDate = new Date(since);
    msgs = msgs.filter(m => new Date(m.timestamp) > sinceDate);
  }

  const max = Math.min(parseInt(limit, 10) || 50, 500);
  msgs = msgs.slice(-max);

  res.json({ accountId: id, count: msgs.length, messages: msgs });
});

// ── All messages from ALL accounts ──
app.get("/messages", (req, res) => {
  const { since, limit = "100" } = req.query;
  const result = {};

  for (const acc of manager.list()) {
    let msgs = messageStore.get(acc.id) || loadMessages(acc.id);
    if (since) {
      const sinceDate = new Date(since);
      msgs = msgs.filter(m => new Date(m.timestamp) > sinceDate);
    }
    const max = Math.min(parseInt(limit, 10) || 100, 500);
    if (msgs.length > 0) result[acc.id] = msgs.slice(-max);
  }

  res.json(result);
});

// Resolve full group info for an account.
// getAllGroups() returns { version, gridVerMap: { groupId: version } } — NOT a list.
// We must fetch names/members via getGroupInfo(), which caps at ~50 ids per request.
async function resolveGroups(acc) {
  const raw = await acc.api.getAllGroups().catch(() => null);
  // gridVerMap holds the group ids; fall back to array shape just in case
  let ids = [];
  if (raw && raw.gridVerMap) ids = Object.keys(raw.gridVerMap);
  else if (Array.isArray(raw)) return raw; // already resolved (older lib shape)
  else if (Array.isArray(raw?.data)) return raw.data;

  const BATCH = 50;
  const out = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    try {
      const info = await acc.api.getGroupInfo(chunk);
      const map = info?.gridInfoMap || {};
      for (const g of Object.values(map)) out.push(g);
    } catch (e) {
      console.log(`[groups] getGroupInfo batch failed (${chunk.length}): ${e.message}`);
    }
  }
  return out;
}

// ── Conversation history (fetch from Zalo API) ──
app.get("/accounts/:id/conversations", async (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    const [friends, groups] = await Promise.all([
      acc.api.getAllFriends().catch(() => []),
      resolveGroups(acc),
    ]);

    const convs = [
      ...(Array.isArray(friends) ? friends.map(f => ({
        id: f.userId || f.id,
        name: f.displayName || f.name || f.userId,
        type: "direct",
        avatar: f.avatar,
      })) : []),
      ...(Array.isArray(groups) ? groups.map(g => ({
        id: g.groupId || g.id,
        name: g.name || g.groupName || g.groupId,
        type: "group",
        members: g.totalMember || g.memberCount,
      })) : []),
    ];

    res.json({ ok: true, accountId: id, conversations: convs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat history for a specific thread ──
app.get("/accounts/:id/history/:threadId", async (req, res) => {
  const { id, threadId } = req.params;
  const { count = "30" } = req.query;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    let msgs;
    // Try group history first, fall back to direct message history
    try {
      msgs = await acc.api.getGroupChatHistory(threadId, parseInt(count, 10));
    } catch {
      // Try fetching messages individually - zca-js may not have a direct-history API
      msgs = [];
    }

    // Normalize the response
    const normalized = Array.isArray(msgs)
      ? msgs.map(m => m.data || m)
      : [];

    res.json({ ok: true, accountId: id, threadId, messages: normalized });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get all friends ──
app.get("/accounts/:id/friends", async (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);

  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    const friends = await acc.api.getAllFriends();
    res.json({ ok: true, accountId: id, friends });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get all groups ──
app.get("/accounts/:id/groups", async (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    const groups = await resolveGroups(acc);
    res.json({ ok: true, accountId: id, count: groups.length, groups });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Backfill history over WebSocket ──
// Replaces /sync, which relies on the retired REST /api/group/history endpoint.
// Asks Zalo for old direct + group messages; they arrive asynchronously on the
// listener's "old_messages" event, so we wait briefly and report what landed.
app.post("/accounts/:id/backfill", async (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  const waitMs = Math.min(parseInt(req.query.wait, 10) || 8000, 60000);

  try {
    backfillTally.set(id, { direct: 0, group: 0 });

    // Without lastMsgId Zalo replays the same first batch every time. Default to
    // the oldest message we already hold so repeated calls walk further back.
    const store = messageStore.get(id) || loadMessages(id);
    const oldestOf = (kind) => {
      const rows = store.filter((m) => m.type === kind && m.msgId);
      if (!rows.length) return null;
      return rows.reduce((a, b) => ((a.ts ?? 0) <= (b.ts ?? 0) ? a : b)).msgId;
    };

    const directLast = req.query.lastMsgId || oldestOf("direct");
    const groupLast = req.query.lastMsgId || oldestOf("group");

    // zca-js hardcodes first:true, which makes Zalo replay the same opening
    // window. Send the payload directly so we can set first:false and page back.
    const requestOld = (threadType, lastId) => {
      if (lastId) {
        acc.api.listener.sendWs({
          version: 1,
          cmd: threadType === 0 ? 510 : 511,
          subCmd: 1,
          data: { first: false, lastId, preIds: [] },
        });
      } else {
        acc.api.listener.requestOldMessages(threadType, null);
      }
    };

    requestOld(0, directLast); // ThreadType.User
    requestOld(1, groupLast); // ThreadType.Group

    await new Promise((r) => setTimeout(r, waitMs));

    const counts = backfillTally.get(id) || { direct: 0, group: 0 };
    res.json({
      ok: true,
      accountId: id,
      waitedMs: waitMs,
      added: counts,
      total: counts.direct + counts.group,
      note: "Zalo trả lịch sử theo batch qua WebSocket. Gọi lại endpoint này để kéo thêm nếu cần.",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Sync: fetch history from all groups and save to message store ──
app.post("/accounts/:id/sync", async (req, res) => {
  const { id } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    console.log(`[sync:${id}] Fetching groups...`);
    const groupsArr = await resolveGroups(acc);
    let totalMsgs = 0;

    for (const g of groupsArr.slice(0, 20)) { // limit to first 20 groups to avoid rate-limit
      const gid = g.groupId || g.id;
      const gname = g.name || g.groupName || gid;
      try {
        console.log(`[sync:${id}] Fetching history for group: ${gname} (${gid})`);
        const hist = await acc.api.getGroupChatHistory(gid, 50);

        // Parse messages from history response
        const msgs = hist?.groupMsgs || [];
        let added = 0;
        for (const m of msgs) {
          if (!messageStore.has(id)) messageStore.set(id, loadMessages(id));
          const store = messageStore.get(id);
          const msgId = m.msgId || m.cliMsgId;
          const exists = msgId && store.some(ex => ex.msgId === msgId);
          if (!exists && m.content) {
            store.push({
              timestamp: new Date(m.ts || Date.now()).toISOString(),
              type: "group",
              threadId: gid,
              groupId: gid,
              groupName: gname,
              senderId: m.uidFrom,
              senderName: m.dName || null,
              text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
              msgId,
              ts: m.ts,
              synced: true,
            });
            added++;
          }
        }
        if (added > 0) {
          totalMsgs += added;
          saveMessages(id, store);
        }
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.log(`[sync:${id}] Failed group ${gname}: ${e.message}`);
      }
    }

    res.json({ ok: true, accountId: id, syncedMessages: totalMsgs, groupsChecked: groupsArr.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Sync a single group: fetch the latest N messages and save to store ──
app.post("/accounts/:id/sync/:groupId", async (req, res) => {
  const { id, groupId } = req.params;
  const acc = manager.getAccount(id);
  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  // Default to 200, cap at 1000 to stay within Zalo's practical limits
  const count = Math.min(parseInt(req.query.count, 10) || 200, 1000);

  try {
    console.log(`[sync:${id}] Fetching latest ${count} messages for group ${groupId}...`);
    const hist = await acc.api.getGroupChatHistory(groupId, count);

    const msgs = hist?.groupMsgs || [];
    // Resolve a group name for nicer records (best-effort)
    let gname = groupId;
    try {
      const info = await acc.api.getGroupInfo([groupId]);
      const g = info?.gridInfoMap?.[groupId];
      if (g) gname = g.name || g.groupName || groupId;
    } catch { /* optional */ }

    if (!messageStore.has(id)) messageStore.set(id, loadMessages(id));
    const store = messageStore.get(id);

    let added = 0;
    for (const m of msgs) {
      const msgId = m.msgId || m.cliMsgId;
      const exists = msgId && store.some(ex => ex.msgId === msgId);
      if (!exists && m.content) {
        store.push({
          timestamp: new Date(m.ts || Date.now()).toISOString(),
          type: "group",
          threadId: groupId,
          groupId,
          groupName: gname,
          senderId: m.uidFrom,
          senderName: m.dName || null,
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          msgId,
          ts: m.ts,
          synced: true,
        });
        added++;
      }
    }
    if (added > 0) saveMessages(id, store);

    res.json({
      ok: true,
      accountId: id,
      groupId,
      groupName: gname,
      fetched: msgs.length,
      added,
      more: hist?.more ?? null,
    });
  } catch (e) {
    // Zalo retired the unversioned /api/group/history endpoint (zca-js issues #356/#367).
    // getGroupChatHistory currently 404s for ALL groups until zca-js ships a fix.
    if (/404/.test(e.message)) {
      return res.status(502).json({
        error: "Zalo group-history endpoint không còn hoạt động (404). Đây là lỗi upstream của zca-js (#356/#367) — chưa có bản vá. Tin real-time vẫn nhận bình thường; chỉ kéo lịch sử cũ là hỏng.",
        code: "GROUP_HISTORY_UNAVAILABLE",
      });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Send message ──
app.post("/accounts/:id/send", async (req, res) => {
  const { id } = req.params;
  const { threadId, text } = req.body;
  const acc = manager.getAccount(id);

  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  if (!threadId || !text) {
    return res.status(400).json({ error: "threadId and text are required" });
  }

  try {
    const result = await acc.api.sendMessage(text, threadId);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get user info ──
app.get("/accounts/:id/user/:userId", async (req, res) => {
  const { id, userId } = req.params;
  const acc = manager.getAccount(id);

  if (!acc) return res.status(404).json({ error: "Account not logged in" });

  try {
    const info = await acc.api.getUserInfo(userId);
    res.json({ ok: true, accountId: id, userId, info });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── QR raw PNG image (auto-refreshes via meta tag if expired) ──
app.get("/qr/:accountId.png", (_req, res) => {
  const { accountId } = _req.params;
  const acc = manager.accounts.get(accountId);
  const imgB64 = acc?.qrData?.image;

  if (imgB64) {
    const buf = Buffer.from(imgB64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.send(buf);
  }

  // No QR — return a simple "waiting" image
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">
    <rect width="300" height="300" fill="#f5f5f5"/>
    <text x="150" y="140" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#999">Waiting for QR...</text>
    <text x="150" y="165" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#aaa">POST /accounts/${accountId}/login to start</text>
  </svg>`);
});

// ── QR HTML page (simple auto-refresh with PNG img) ──
app.get("/qr/:accountId/view", (_req, res) => {
  const { accountId } = _req.params;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8">
  <meta http-equiv="refresh" content="2">
  <title>Zalo Login — ${accountId}</title>
  <style>
    body { font-family: -apple-system, sans-serif; text-align: center; padding: 40px; background: #f5f5f5; }
    h2 { color: #0068FF; margin-bottom: 5px; }
    p { margin: 5px 0; color: #555; }
    #qr { display: inline-block; background: white; padding: 16px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    #qr img { width: 280px; height: 280px; }
  </style></head><body>
  <h2>📱 Scan Zalo — ${accountId}</h2>
  <p>Mở Zalo app → tab Cá nhân → icon QR scan (góc trên phải)</p>
  <div id="qr"><img src="/qr/${accountId}.png" alt="Zalo QR"></div>
  <p style="font-size:12px;color:#999;margin-top:15px;">Trang tự refresh mỗi 2 giây</p>
</body></html>`);
});

// ── Dashboard ──
app.get("/", (_req, res) => {
  res.redirect("/dashboard");
});

app.get("/dashboard", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(fs.readFileSync(path.join(__dirname, "dashboard.html"), "utf-8"));
});

// ── SSE real-time events (login-success pushes to dashboard) ──
app.get("/events", (_req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const onMsg = (evt) => {
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`);
  };
  const onLogin = (data) => onMsg({ type: "login-success", data });
  const onDisconnect = (data) => onMsg({ type: "disconnected", data });
  const onMsgEvt = (data) => onMsg({ type: "new-message", data });

  manager.on("login-success", onLogin);
  manager.on("disconnected", onDisconnect);
  manager.on("message", onMsgEvt);
  manager.on("group_message", onMsgEvt);

  res.on("close", () => {
    manager.off("login-success", onLogin);
    manager.off("disconnected", onDisconnect);
    manager.off("message", onMsgEvt);
    manager.off("group_message", onMsgEvt);
  });
});

// Start
app.listen(PORT, HOST, async () => {
  console.log(`[zalo-multi-bridge] API server on http://${HOST}:${PORT}`);
  console.log(`[zalo-multi-bridge] Data dir: ${process.env.ZALO_MULTI_DATA_DIR || "~/.zalo-multi-bridge"}`);

  const accounts = manager.list();
  if (accounts.length > 0) {
    console.log(`[zalo-multi-bridge] ${accounts.length} account(s) on disk:`);
    for (const acc of accounts) {
      const status = acc.active ? "active" : acc.hasCredentials ? "auto-login..." : "needs login";
      console.log(`  - ${acc.id} (${status})`);
    }

    // Auto-login accounts that have saved credentials
    const toLogin = accounts.filter(a => a.hasCredentials && !a.active);
    if (toLogin.length > 0) {
      console.log(`[zalo-multi-bridge] Auto-logging in ${toLogin.length} account(s)...`);
      for (const acc of toLogin) {
        try {
          const result = await manager.login(acc.id);
          console.log(`  ✓ ${acc.id} → ${result?.displayName || result?.ownId || "ok"}`);
        } catch (e) {
          console.log(`  ✗ ${acc.id} → ${e.message}`);
        }
      }
    }
  } else {
    console.log(`[zalo-multi-bridge] No accounts yet. Use: ./cli.js add <name>`);
  }
});

export default app;
