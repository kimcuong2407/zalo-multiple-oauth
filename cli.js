#!/usr/bin/env node
// cli.js — CLI for zalo-multi-bridge.
// Manage Zalo accounts: add, login, list, status.

import { manager } from "./accounts.js";
import readline from "node:readline";

const HELP = `
zalo-multi-bridge CLI

Usage:
  node cli.js add <name>       — Create a new account and login via QR
  node cli.js login <name>     — Login existing account (or re-login)
  node cli.js list              — List all accounts and their status
  node cli.js status            — Show account statuses
  node cli.js logout <name>    — Logout an account
  node cli.js start             — Start the HTTP API server
  node cli.js help              — Show this help

Examples:
  node cli.js add work          # Add account "work", scan QR
  node cli.js login work        # Re-login account "work"
  node cli.js list              # See all accounts
`;

const cmd = process.argv[2];
const arg = process.argv[3];

// Setup data dir
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_DIR = process.env.ZALO_MULTI_DATA_DIR || path.join(os.homedir(), ".zalo-multi-bridge");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(path.join(DATA_DIR, "accounts"), { recursive: true });
}

async function waitForEnter() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Press Enter after scanning the QR code...", () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  switch (cmd) {
    case "add":
    case "login": {
      if (!arg) {
        console.log("Usage: node cli.js add <name>");
        process.exit(1);
      }
      console.log(`[${cmd}] Starting login for account: ${arg}`);
      console.log("A QR code will appear. Scan it with Zalo on your phone.");
      console.log("Waiting for QR...\n");

      // Listen for QR events
      manager.on("qr-ascii", ({ accountId, qrAscii }) => {
        console.log(qrAscii);
        console.log(`\n[${accountId}] Scan this QR code with Zalo app in ~2 minutes`);
      });

      manager.on("qr", ({ accountId }) => {
        // Non-ascii fallback
      });

      manager.on("qr-expired", ({ accountId }) => {
        console.log(`[${accountId}] QR expired, generating new one...`);
      });

      manager.on("qr-scanned", ({ accountId }) => {
        console.log(`\n[${accountId}] QR scanned! Waiting for confirmation...`);
      });

      try {
        const result = await manager.login(arg);
        console.log(`\n[${arg}] Login successful!`);
        console.log(`  ownId: ${result.ownId}`);
        console.log(`  name: ${result.displayName || "N/A"}`);
        console.log(`\nThe account will stay connected as long as this process runs.`);
        console.log(`Run 'node cli.js start' to start the API server.`);
      } catch (e) {
        console.error(`\n[${arg}] Login failed:`, e.message);
        process.exit(1);
      }

      // Keep running
      console.log(`\n[${arg}] Connected. Press Ctrl+C to quit.`);
      process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await manager.logout(arg);
        process.exit(0);
      });
      break;
    }

    case "list":
    case "status": {
      const accounts = manager.list();
      if (accounts.length === 0) {
        console.log("No accounts configured.");
        console.log("Use: node cli.js add <name>");
      } else {
        console.log("Accounts:");
        for (const acc of accounts) {
          const status = acc.active ? "🟢 active" : acc.hasCredentials ? "🟡 logged out (credentials saved)" : "🔴 needs login";
          const extra = acc.displayName ? ` (${acc.displayName})` : "";
          console.log(`  ${acc.id} ${status}${extra}`);
          if (acc.ownId) console.log(`    ownId: ${acc.ownId}`);
        }
      }
      process.exit(0);
    }

    case "logout": {
      if (!arg) {
        console.log("Usage: node cli.js logout <name>");
        process.exit(1);
      }
      await manager.logout(arg);
      console.log(`[${arg}] Logged out.`);
      process.exit(0);
    }

    case "start": {
      console.log("Starting API server...");
      // Dynamic import to start server
      await import("./server.js");
      break;
    }

    default:
      console.log(HELP);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
