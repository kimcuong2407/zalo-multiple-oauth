import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { Zalo } from "zca-js";
const utilsUrl = new URL("./node_modules/zca-js/dist/utils.js", import.meta.url).href;
const { encodeAES, makeURL, request } = await import(utilsUrl);

const GID = process.argv[2] || "3191053586460264774";
const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(),".zalo-multi-bridge","accounts","personal","credentials.json"),"utf-8"));
const api = await new Zalo({selfListen:false,userAgent:creds.userAgent,language:"vi"}).login(creds);
const ctx = api.getContext();
const host = api.zpwServiceMap.group_cloud_message[0];

async function call(pathname, payload, label) {
  try {
    const enc = encodeAES(ctx.secretKey, JSON.stringify(payload));
    const url = makeURL(ctx, `${host}${pathname}`, { params: enc });
    const res = await request(ctx, url, { method: "GET" });
    const b = await res.json().catch(()=>null);
    const d = b?.data;
    const raw = typeof d === "string" ? d : JSON.stringify(d);
    console.log(`[${b?.error_code}] ${label} :: ${b?.error_message} :: ${raw ? raw.slice(0,150) : "no data"}`);
  } catch(e) { console.log(`[ERR] ${label} :: ${e.message}`); }
  await new Promise(r=>setTimeout(r,350));
}

const base = { groupId: GID, count: 20, msgIds: [] };
// src values seen in the bundle: -1 (default), 3 (my-cloud viewer)
for (const src of [-1, 0, 1, 3]) {
  await call("/api/cm/getrecentv2", {...base, globalMsgId: 0, imei: ctx.imei, src}, `recent src=${src}`);
}
// try with/without imei, and isOA
await call("/api/cm/getrecentv2", {...base, globalMsgId: 0, src: -1}, "recent no-imei");
await call("/api/cm/getrecentv2", {...base, globalMsgId: 0, imei: ctx.imei, src: 3, isOA: 1}, "recent isOA=1");
// zcloud "my cloud" = own uid as groupId
await call("/api/cm/getrecentv2", {groupId: ctx.uid, count:20, msgIds:[], globalMsgId:0, imei: ctx.imei, src:3, isOA:1}, "recent myCloud(uid)");
process.exit(0);
