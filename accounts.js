// accounts.js — Multi-account Zalo manager.
// Manages multiple Zalo API instances simultaneously using zca-js v2.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Zalo } from "zca-js";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let qrcodeTerminal = null;
try {
  qrcodeTerminal = require("qrcode-terminal");
} catch {
  // Optional - works without it
}

const DATA_DIR = process.env.ZALO_MULTI_DATA_DIR || path.join(os.homedir(), ".zalo-multi-bridge");
const ACCOUNTS_DIR = path.join(DATA_DIR, "accounts");

// zca-js v2 LoginQRCallbackEventType values
const QR_GENERATED = 0;
const QR_EXPIRED = 1;
const QR_SCANNED = 2;
const QR_DECLINED = 3;
const QR_GOT_LOGIN_INFO = 4;

class AccountManager extends EventEmitter {
  constructor() {
    super();
    // accountId -> { api, ownId, displayName, creds, qrData, qrExpiresIn }
    this.accounts = new Map();
  }

  _ensureDir(accountId) {
    if (!/^[A-Za-z0-9_-]+$/.test(accountId)) {
      throw new Error("account ID must contain only letters, numbers, underscores, and hyphens");
    }
    const dir = path.join(ACCOUNTS_DIR, accountId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  _credentialsPath(accountId) {
    return path.join(this._ensureDir(accountId), "credentials.json");
  }

  _loadCredentials(accountId) {
    const p = this._credentialsPath(accountId);
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, "utf-8"));
      } catch {
        return null;
      }
    }
    return null;
  }

  _saveCredentials(accountId, creds) {
    const p = this._credentialsPath(accountId);
    fs.writeFileSync(p, JSON.stringify(creds, null, 2), { mode: 0o600 });
  }

  hasCredentials(accountId) {
    return this._loadCredentials(accountId) !== null;
  }

  list() {
    if (!fs.existsSync(ACCOUNTS_DIR)) return [];
    const dirs = fs.readdirSync(ACCOUNTS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    return dirs.map((id) => {
      const acc = this.accounts.get(id);
      return {
        id,
        hasCredentials: this._loadCredentials(id) !== null,
        active: !!(acc && acc.api),
        ownId: acc?.ownId || null,
        displayName: acc?.displayName || null,
      };
    });
  }

  /** Setup event listeners after getting an API instance */
  async _setupApi(accountId, api, creds = null) {
    const ownId = api.uid || api.context?.uid;

    let displayName = null;
    try {
      const info = await api.getUserInfo(ownId);
      displayName = info?.changed_profiles?.[ownId]?.displayName || info?.name || null;
    } catch {
      // optional
    }

    const entry = {
      api,
      ownId,
      displayName,
      creds,
      qrData: null,
      qrExpiresIn: null,
    };
    this.accounts.set(accountId, entry);

    // Listen for incoming messages via zca-js v2 listener
    api.listener.on("message", (msg) => {
      const isGroup = msg.type === 1; // ThreadType.Group
      const eventName = isGroup ? "group_message" : "message";
      this.emit(eventName, {
        accountId,
        ownId,
        message: msg,
      });
    });

    // Historical messages arrive here in response to listener.requestOldMessages().
    // Zalo retired the REST /api/group/history endpoint (zca-js #356/#367), so the
    // WebSocket path is the only way left to backfill history.
    api.listener.on("old_messages", (messages, threadType) => {
      const eventName = threadType === 1 ? "old_group_messages" : "old_messages";
      this.emit(eventName, { accountId, ownId, messages });
    });

    // Also listen for error/closed on the listener
    api.listener.on("error", (err) => {
      this.emit("error", { accountId, error: err?.message || String(err) });
    });

    api.listener.on("connected", () => {
      console.log(`[account:${accountId}] Listener connected`);
      this.emit("listener-connected", { accountId });
    });

    api.listener.on("closed", (code, reason) => {
      console.log(`[account:${accountId}] Listener closed: ${code} ${reason || ""}`);
      this.emit("listener-closed", { accountId, code, reason });
    });

    // Without this the WebSocket never opens and no messages ever arrive.
    api.listener.start({ retryOnClose: true });

    this.emit("login-success", { accountId, ownId, displayName });

    console.log(`[account:${accountId}] Logged in as ${displayName || ownId}`);
    return { ownId, displayName };
  }

  /** Login using saved credentials (cookie + imei) */
  async _loginWithCredentials(accountId) {
    const creds = this._loadCredentials(accountId);
    if (!creds) {
      throw new Error("No saved credentials for account: " + accountId);
    }

    const zalo = new Zalo({
      selfListen: false,
      userAgent: creds.userAgent,
      language: creds.language || "vi",
    });

    let api;
    try {
      api = await zalo.login(creds);
    } catch (e) {
      // Credentials expired — remove them
      try { fs.unlinkSync(this._credentialsPath(accountId)); } catch {}
      throw new Error("Credentials expired: " + e.message);
    }

    return this._setupApi(accountId, api, creds);
  }

  /** Login via QR code (v2 API) — retries on expiry */
  async _loginWithQR(accountId) {
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";
    const language = "vi";
    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      const zalo = new Zalo({ selfListen: false, userAgent, language });

      this.accounts.set(accountId, {
        api: null, ownId: null, displayName: null,
        qrData: null, qrExpiresIn: null,
      });

      // QR callback
      const onQR = (event) => {
        switch (event.type) {
          case QR_GENERATED: {
            const qrStr = event.data?.qrcode || event.data;
            this.emit("qr", { accountId, qrImageData: qrStr, expiresIn: 120 });
            if (qrcodeTerminal) {
              qrcodeTerminal.generate(qrStr, { small: true }, (qr) => {
                this.emit("qr-ascii", { accountId, qrAscii: qr });
              });
            }
            const acc = this.accounts.get(accountId);
            if (acc) { acc.qrData = qrStr; acc.qrExpiresIn = 120; }
            break;
          }
          case QR_EXPIRED:
            this.emit("qr-expired", { accountId });
            break;
          case QR_SCANNED:
            this.emit("qr-scanned", { accountId });
            break;
          case QR_DECLINED:
            this.emit("qr-declined", { accountId });
            break;
          case QR_GOT_LOGIN_INFO:
            if (event.data) {
              this._saveCredentials(accountId, {
                cookie: event.data.cookie,
                imei: event.data.imei,
                userAgent: event.data.userAgent || userAgent,
                language,
              });
            }
            break;
        }
      };

      try {
        const api = await zalo.loginQR({ userAgent, language }, onQR);
        return this._setupApi(accountId, api, null);
      } catch (e) {
        retries++;
        this.accounts.delete(accountId);
        if (retries >= maxRetries) throw e;
        // QR expired or failed — retry automatically
        console.log(`[account:${accountId}] QR expired/timed out, retrying (${retries}/${maxRetries})...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    throw new Error("Max QR retries reached");
  }

  /** Login an account: try saved creds first, fall back to QR */
  async login(accountId) {
    if (this.isLoggedIn(accountId)) {
      return { message: "Already logged in" };
    }

    const creds = this._loadCredentials(accountId);
    if (creds) {
      try {
        return await this._loginWithCredentials(accountId);
      } catch (e) {
        console.log(`[account:${accountId}] Saved credentials failed: ${e.message}, starting QR login...`);
      }
    }

    // No valid credentials — do QR login
    return this._loginWithQR(accountId);
  }

  /** Logout and disconnect an account */
  async logout(accountId) {
    const acc = this.accounts.get(accountId);
    if (!acc) return;
    try {
      // Try to call logout if available
      if (typeof acc.api?.logout === "function") {
        await acc.api.logout();
      }
    } catch {
      // ignore
    }
    this.accounts.delete(accountId);
    this.emit("disconnected", { accountId });
  }

  getAccount(accountId) {
    const acc = this.accounts.get(accountId);
    return acc?.api ? acc : null;
  }

  isLoggedIn(accountId) {
    const acc = this.accounts.get(accountId);
    return !!(acc && acc.api);
  }
}

const manager = new AccountManager();
export { manager, AccountManager };
