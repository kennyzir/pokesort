export async function triggerPagesDeploy(env, { fetchImplementation = fetch, scheduledTime = Date.now() } = {}) {
  if (typeof env?.PAGES_DEPLOY_HOOK_URL !== "string" || !/^https:\/\/api\.cloudflare\.com\//.test(env.PAGES_DEPLOY_HOOK_URL)) {
    throw new Error("PAGES_DEPLOY_HOOK_URL_REQUIRED");
  }
  const response = await fetchImplementation(env.PAGES_DEPLOY_HOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trigger: "pokesort-daily-utc-refresh", scheduledTime }),
  });
  if (!response.ok) throw new Error(`PAGES_DEPLOY_HOOK_FAILED:${response.status}`);
  return { gate: "PASS", scheduledTime, status: response.status };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(triggerPagesDeploy(env, { scheduledTime: controller.scheduledTime }));
  },
  async fetch() {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  },
};
