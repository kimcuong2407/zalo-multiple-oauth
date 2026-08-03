import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA_VERSION = 1;

function toSourceTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dedupeKey(message) {
  return message.msgId ? `zalo-msg:${message.msgId}` : null;
}

export class MessageStore {
  constructor({ dataDir, logger = console } = {}) {
    if (!dataDir) throw new Error("MessageStore requires dataDir");

    this.dataDir = dataDir;
    this.logger = logger;
    fs.mkdirSync(dataDir, { recursive: true });

    this.databasePath = path.join(dataDir, "messages.sqlite");
    this.db = new Database(this.databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");

    this._initializeSchema();
    this._prepareStatements();
    try {
      this.migrateLegacyJsonMessages();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  _initializeSchema() {
    const version = this.db.pragma("user_version", { simple: true });
    if (version > SCHEMA_VERSION) {
      throw new Error(`Unsupported messages database version: ${version}`);
    }

    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY,
          account_id TEXT NOT NULL,
          dedupe_key TEXT,
          timestamp TEXT NOT NULL,
          source_ts INTEGER,
          type TEXT,
          thread_id TEXT,
          msg_id TEXT,
          message_json TEXT NOT NULL,
          inserted_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_account_dedupe
          ON messages (account_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_messages_account_timestamp
          ON messages (account_id, timestamp, id);

        CREATE INDEX IF NOT EXISTS idx_messages_backfill_cursor
          ON messages (account_id, type, source_ts, id)
          WHERE msg_id IS NOT NULL;

        CREATE TABLE IF NOT EXISTS legacy_message_imports (
          source_path TEXT PRIMARY KEY,
          sha256 TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          imported_rows INTEGER NOT NULL
        );

        PRAGMA user_version = 1;
      `);
    }
  }

  _prepareStatements() {
    this.insertStatement = this.db.prepare(`
      INSERT OR IGNORE INTO messages (
        account_id, dedupe_key, timestamp, source_ts, type,
        thread_id, msg_id, message_json, inserted_at
      ) VALUES (
        @accountId, @dedupeKey, @timestamp, @sourceTs, @type,
        @threadId, @msgId, @messageJson, @insertedAt
      )
    `);

    this.insertLegacyStatement = this.db.prepare(`
      INSERT INTO messages (
        account_id, dedupe_key, timestamp, source_ts, type,
        thread_id, msg_id, message_json, inserted_at
      ) VALUES (
        @accountId, @dedupeKey, @timestamp, @sourceTs, @type,
        @threadId, @msgId, @messageJson, @insertedAt
      )
    `);

    this.findDedupeStatement = this.db.prepare(`
      SELECT 1 FROM messages
      WHERE account_id = ? AND dedupe_key = ?
      LIMIT 1
    `);

    this.importLookupStatement = this.db.prepare(`
      SELECT sha256, imported_rows AS importedRows
      FROM legacy_message_imports
      WHERE source_path = ?
    `);

    this.importRecordStatement = this.db.prepare(`
      INSERT INTO legacy_message_imports (
        source_path, sha256, imported_at, imported_rows
      ) VALUES (?, ?, ?, ?)
    `);

    this.oldestMessageStatement = this.db.prepare(`
      SELECT msg_id AS msgId
      FROM messages
      WHERE account_id = ? AND type = ? AND msg_id IS NOT NULL
      ORDER BY COALESCE(source_ts, 0) ASC, id ASC
      LIMIT 1
    `);

    this.countStatement = this.db.prepare(`
      SELECT COUNT(*) AS count FROM messages WHERE account_id = ?
    `);

    this.listMessagesStatement = this.db.prepare(`
      SELECT message_json FROM (
        SELECT id, message_json
        FROM messages
        WHERE account_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC
    `);

    this.listMessagesSinceStatement = this.db.prepare(`
      SELECT message_json FROM (
        SELECT id, message_json
        FROM messages
        WHERE account_id = ? AND julianday(timestamp) > julianday(?)
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC
    `);
  }

  _row(accountId, message, key = dedupeKey(message)) {
    const timestamp = message.timestamp || new Date().toISOString();
    const normalized = message.timestamp ? message : { timestamp, ...message };

    return {
      accountId,
      dedupeKey: key,
      timestamp,
      sourceTs: toSourceTimestamp(normalized.ts),
      type: normalized.type || null,
      threadId: normalized.threadId == null ? null : String(normalized.threadId),
      msgId: normalized.msgId == null ? null : String(normalized.msgId),
      messageJson: JSON.stringify(normalized),
      insertedAt: new Date().toISOString(),
    };
  }

  insertMessage(accountId, message) {
    if (!accountId) throw new Error("accountId is required");
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new Error("message must be an object");
    }

    const result = this.insertStatement.run(this._row(accountId, message));
    return { inserted: result.changes === 1 };
  }

  listMessages(accountId, { since, limit = 50 } = {}) {
    const safeLimit = Math.max(0, Math.trunc(Number(limit)) || 0);
    if (safeLimit === 0) return [];

    let sinceIso = null;
    if (since) {
      const date = new Date(since);
      if (Number.isNaN(date.getTime())) return [];
      sinceIso = date.toISOString();
    }

    const rows = sinceIso
      ? this.listMessagesSinceStatement.all(accountId, sinceIso, safeLimit)
      : this.listMessagesStatement.all(accountId, safeLimit);

    return rows.map((row) => JSON.parse(row.message_json));
  }

  findOldestMessageId(accountId, type) {
    return this.oldestMessageStatement.get(accountId, type)?.msgId || null;
  }

  countMessages(accountId) {
    return this.countStatement.get(accountId).count;
  }

  migrateLegacyJsonMessages() {
    const legacyDir = path.join(this.dataDir, "messages");
    if (!fs.existsSync(legacyDir)) return;

    const files = fs.readdirSync(legacyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of files) {
      const sourcePath = path.join(legacyDir, entry.name);
      const bytes = fs.readFileSync(sourcePath);
      const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
      const previous = this.importLookupStatement.get(sourcePath);

      if (previous) {
        if (previous.sha256 !== checksum) {
          this.logger.warn(
            `[messages:migrate] Legacy file changed after import; skipping: ${sourcePath}`,
          );
        }
        continue;
      }

      let messages;
      try {
        messages = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        throw new Error(`Cannot parse legacy messages file ${sourcePath}: ${error.message}`);
      }
      if (!Array.isArray(messages)) {
        throw new Error(`Legacy messages file must contain an array: ${sourcePath}`);
      }

      const accountId = path.basename(entry.name, ".json");
      const importFile = this.db.transaction(() => {
        const seenKeys = new Set();
        for (const message of messages) {
          if (!message || typeof message !== "object" || Array.isArray(message)) {
            throw new Error(`Invalid message record in ${sourcePath}`);
          }

          let key = dedupeKey(message);
          if (key && (seenKeys.has(key) || this.findDedupeStatement.get(accountId, key))) {
            key = null;
          } else if (key) {
            seenKeys.add(key);
          }
          this.insertLegacyStatement.run(this._row(accountId, message, key));
        }
        this.importRecordStatement.run(
          sourcePath,
          checksum,
          new Date().toISOString(),
          messages.length,
        );
      });

      try {
        importFile();
      } catch (error) {
        throw new Error(`Cannot migrate legacy messages file ${sourcePath}: ${error.message}`);
      }
      this.logger.log(`[messages:migrate] Imported ${messages.length} messages from ${sourcePath}`);
    }
  }

  close() {
    if (this.db?.open) this.db.close();
  }
}
