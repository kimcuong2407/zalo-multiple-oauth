// cloud_history.mjs — Group history via Zalo's cloud-message API.
//
// zca-js's getGroupChatHistory calls /api/group/history, which now 404s. That
// endpoint is gated behind the server-side feature flag
// settings.features.enable_fetch_history_message, which this account does not
// have, and the shipping client only calls it when re-joining a group.
//
// The endpoint the client actually uses for scrollback is the group-cloud API,
// reconstructed here from the desktop bundle:
//
//   getCM(groupId, globalMsgId=0, old=0, count=50):
//     host  = zpwServiceMap.group_cloud_message[0]
//     path  = old ? "/api/cm/getoldv2" : "/api/cm/getrecentv2"
//     query = zpw_ver & zpw_type & params=<AES({groupId, globalMsgId, count, msgIds, imei, src})>
//
// Pass globalMsgId from the oldest message you hold to page backwards.

const utilsUrl = new URL("./node_modules/zca-js/dist/utils.js", import.meta.url).href;
const { encodeAES, makeURL, request } = await import(utilsUrl);

/**
 * Fetch a page of group messages from the cloud-message store.
 *
 * @param {object} ctx     zca-js context (api.getContext())
 * @param {object} svc     zpwServiceMap
 * @param {string} groupId group id, with or without a leading "g"
 * @param {object} opts    { old = true, globalMsgId = 0, count = 50 }
 */
export async function getCloudMessages(ctx, svc, groupId, opts = {}) {
  const { old = true, globalMsgId = 0, count = 50 } = opts;

  // The client strips a leading "g" before sending.
  const gid = groupId.startsWith("g") ? groupId.slice(1) : groupId;

  const payload = {
    groupId: gid,
    globalMsgId,
    count,
    msgIds: [],
    imei: ctx.imei,
    src: -1,
  };

  const host = svc.group_cloud_message?.[0];
  if (!host) throw new Error("group_cloud_message host missing from service map");

  const path = old ? "/api/cm/getoldv2" : "/api/cm/getrecentv2";
  const enc = encodeAES(ctx.secretKey, JSON.stringify(payload));
  if (!enc) throw new Error("Failed to encrypt params");

  const url = makeURL(ctx, `${host}${path}`, { params: enc });
  const res = await request(ctx, url, { method: "GET" });

  const body = await res.json().catch(() => null);
  if (!body) throw new Error(`Non-JSON response (HTTP ${res.status})`);
  if (body.error_code !== 0) {
    throw new Error(`Zalo error ${body.error_code}: ${body.error_message}`);
  }

  return { status: res.status, data: body.data };
}
