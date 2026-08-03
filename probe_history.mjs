// probe_history.mjs — Probe candidate group-history endpoints against a live session.
// getGroupChatHistory hits an unversioned /api/group/history path that Zalo retired.
// Sibling group APIs moved to versioned paths (getlg/v4, getmg-v2), so this walks
// the plausible variants and reports which ones the server still answers.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Zalo } from "zca-js";

const ACCOUNT = process.argv[2] || "personal";
const GROUP_ID = process.argv[3] || "3191053586460264774";

const credPath = path.join(os.homedir(), ".zalo-multi-bridge", "accounts", ACCOUNT, "credentials.json");
const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));

// zca-js defaults to zpw_ver 671; the shipping Zalo desktop client sends 687.
// Override via env to A/B the two.
const API_VERSION = parseInt(process.env.ZPW_VER || "0", 10) || undefined;

const zalo = new Zalo({
  selfListen: false,
  userAgent: creds.userAgent,
  language: creds.language || "vi",
  ...(API_VERSION ? { apiVersion: API_VERSION } : {}),
});
const api = await zalo.login(creds);
const ctx = api.getContext ? api.getContext() : null;

console.log("Logged in as", api.uid || ctx?.uid);
console.log("zpw_ver =", ctx?.API_VERSION, " zpw_type =", ctx?.API_TYPE);

// Reach the internals the api factories use, so probes are signed/encrypted identically.
const svc = api.zpwServiceMap;
console.log("group hosts:", JSON.stringify(svc.group));
console.log("group_poll hosts:", JSON.stringify(svc.group_poll));

console.log("\n=== full service map ===");
for (const [k, v] of Object.entries(svc)) {
  console.log(` ${k}: ${JSON.stringify(v)}`);
}
console.log("=== end map ===\n");

const G = svc.group[0];

const CANDIDATES = [
  // Control: a sibling endpoint known to work, to prove auth/host are fine.
  ["CONTROL getmg-v2", `${G}/api/group/getmg-v2`],
  ["CONTROL getlg/v4", `${svc.group_poll[0]}/api/group/getlg/v4`],

  ["history", `${G}/api/group/history`],
  ["history-v2", `${G}/api/group/history-v2`],
  ["history/v2", `${G}/api/group/history/v2`],
  ["history/v3", `${G}/api/group/history/v3`],
  ["history/v4", `${G}/api/group/history/v4`],
  ["gethistory", `${G}/api/group/gethistory`],
  ["gethistory/v2", `${G}/api/group/gethistory/v2`],
  ["getmsg", `${G}/api/group/getmsg`],
  ["getmsgs", `${G}/api/group/getmsgs`],
  ["msg/history", `${G}/api/group/msg/history`],
  ["history/get", `${G}/api/group/history/get`],
  ["gethist-v2", `${G}/api/group/gethist-v2`],
  ["loadmsg", `${G}/api/group/loadmsg`],
  ["getconver", `${G}/api/group/getconver`],

  // group_cloud_message is a dedicated host in the service map that zca-js never
  // calls — the most likely new home for group history.
  ["CM history", `${svc.group_cloud_message[0]}/api/group/history`],
  ["CM history/v2", `${svc.group_cloud_message[0]}/api/group/history/v2`],
  ["CM cm/history", `${svc.group_cloud_message[0]}/api/cm/history`],
  ["CM getmsg", `${svc.group_cloud_message[0]}/api/group/getmsg`],
  ["CM gethistory", `${svc.group_cloud_message[0]}/api/group/gethistory`],
  ["CM cloudmsg", `${svc.group_cloud_message[0]}/api/group/cloudmsg`],

];

// Rebuild the encrypt+request pipeline that apiFactory normally injects.
// zca-js exposes no subpath export, so reach the module by file URL.
const utilsUrl = new URL("./node_modules/zca-js/dist/utils.js", import.meta.url).href;
const { encodeAES, makeURL, request } = await import(utilsUrl);

const params = { grid: GROUP_ID, count: 20 };

for (const [label, base] of CANDIDATES) {
  try {
    const enc = encodeAES(ctx.secretKey, JSON.stringify(params));
    const url = makeURL(ctx, base, { params: enc });
    const res = await request(ctx, url, { method: "GET" });
    const text = await res.text();
    let preview = text.slice(0, 160).replace(/\s+/g, " ");
    console.log(`\n[${res.status}] ${label}\n   ${base}\n   ${preview}`);
  } catch (e) {
    console.log(`\n[ERR] ${label}\n   ${base}\n   ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}

process.exit(0);
