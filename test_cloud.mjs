import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Zalo } from "zca-js";
import { getCloudMessages } from "./cloud_history.mjs";

const GID = process.argv[2] || "3191053586460264774";
const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(),".zalo-multi-bridge","accounts","personal","credentials.json"),"utf-8"));
const api = await new Zalo({selfListen:false,userAgent:creds.userAgent,language:"vi"}).login(creds);
const ctx = api.getContext();
console.log("cloud host:", api.zpwServiceMap.group_cloud_message);
for (const old of [true,false]) {
  try {
    const r = await getCloudMessages(ctx, api.zpwServiceMap, GID, { old, count: 20 });
    const raw = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    console.log(`\n[${old?"getoldv2":"getrecentv2"}] HTTP ${r.status} — payload ${raw.length} bytes`);
    console.log("  preview:", raw.slice(0,220));
  } catch (e) { console.log(`\n[${old?"getoldv2":"getrecentv2"}] ERR: ${e.message}`); }
}
process.exit(0);
