// Cloudflare Pages Function for the existing /api/discord endpoint.
// The website's index.html remains unchanged.

const ALLOWED_PATHS = [
  /^\/users\/@me(?:\/guilds)?$/,
  /^\/applications\/@me$/,
  /^\/guilds\/\d+\/channels$/,
  /^\/guilds\/\d+\/members(?:\/(?:@me|\d+))?$/,
  /^\/channels\/\d+\/messages(?:\/\d+)?$/,
  /^\/channels\/\d+\/messages\/\d+\/reactions\/[^/]+\/@me$/,
  /^\/users\/\d+$/,
  /^\/users\/@me\/channels$/,
  /^\/guilds\/\d+$/,
  /^\/guilds\/\d+\/(?:emojis|roles|invites|bans)$/,
  /^\/guilds\/\d+\/bans\/\d+$/,
  /^\/channels\/\d+$/,
  /^\/channels\/\d+\/invites$/,
  /^\/guilds\/\d+\/roles\/\d+$/,
  /^\/guilds\/\d+\/emojis\/\d+$/,
  /^\/guilds\/\d+\/members\/\d+\/roles\/\d+$/,
  /^\/invites\/[\w-]+$/,
  /^\/users\/@me\/guilds\/\d+$/,
];

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function onRequest({ request }) {
  const incomingUrl = new URL(request.url);
  const apiPath = incomingUrl.searchParams.get("path") || "";
  const apiPathOnly = apiPath.split("?")[0];

  if (!apiPath.startsWith("/") || apiPath.startsWith("//") ||
      apiPath.includes("..") ||
      !ALLOWED_PATHS.some((rule) => rule.test(apiPathOnly))) {
    return json({ message: "Path not allowed" }, 400);
  }

  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return json({ message: "Method not allowed" }, 405);
  }

  const token = request.headers.get("x-bot-token");
  if (!token || !/^[-\w.]{20,}$/.test(token)) {
    return json({ message: "A valid bot token is required" }, 401);
  }

  const headers = new Headers({
    Authorization: `Bot ${token}`,
    "Accept": "application/json",
  });

  let body;
  if (["POST", "PATCH", "PUT"].includes(method)) {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ message: "Request body too large" }, 413);
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) {
      return json({ message: "Request body too large" }, 413);
    }
    const contentType = request.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
  }

  const discordUrl = `https://discord.com/api/v10${apiPath}`;
  try {
    const upstream = await fetch(discordUrl, {
      method,
      headers,
      body,
    });

    const responseHeaders = new Headers();
    responseHeaders.set(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json; charset=utf-8"
    );
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return json({ message: "Could not reach Discord API" }, 502);
  }
}
