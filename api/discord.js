// Standalone Node.js server for the Discord control panel.
// Run from the project directory with: node api/discord.js
// Requires Node.js 18+ (Node.js 20/22 recommended).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);

const ALLOWED = [
  /^\/users\/@me(\/guilds)?$/,
  /^\/applications\/@me$/,
  /^\/guilds\/\d+\/channels$/,
  /^\/guilds\/\d+\/members(\/(\@me|\d+))?$/,
  /^\/channels\/\d+\/messages(\/\d+)?$/,
  /^\/users\/\d+$/,
  /^\/users\/@me\/channels$/,
  /^\/guilds\/\d+$/,
  /^\/guilds\/\d+\/(emojis|roles|invites|bans)$/,
  /^\/guilds\/\d+\/bans\/\d+$/,
  /^\/channels\/\d+$/,
  /^\/channels\/\d+\/invites$/,
  /^\/guilds\/\d+\/roles\/\d+$/,
  /^\/guilds\/\d+\/emojis\/\d+$/,
  /^\/guilds\/\d+\/members\/\d+\/roles\/\d+$/,
  /^\/invites\/[\w-]+$/,
  /^\/users\/@me\/guilds\/\d+$/,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, value) {
  const data = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(data);
}

async function readBody(req, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleDiscord(req, res, url) {
  const apiPath = url.searchParams.get('path') || '';
  const token = req.headers['x-bot-token'] || process.env.DISCORD_TOKEN;

  if (!token) return sendJson(res, 401, { message: 'No token' });
  if (apiPath.includes('..') || !ALLOWED.some((rule) => rule.test(apiPath.split('?')[0]))) {
    return sendJson(res, 400, { message: 'Path not allowed' });
  }
  if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return sendJson(res, 405, { message: 'Method not allowed' });
  }

  const headers = { Authorization: `Bot ${token}` };
  let body;
  if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
    try {
      body = await readBody(req);
    } catch (error) {
      return sendJson(res, error.status || 400, { message: error.message });
    }
    headers['Content-Type'] = req.headers['content-type'] || 'application/json';
  }

  try {
    const discordResponse = await fetch(`https://discord.com/api/v10${apiPath}`, {
      method: req.method,
      headers,
      body,
    });
    const responseText = await discordResponse.text();
    res.writeHead(discordResponse.status, {
      'Content-Type': discordResponse.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(responseText);
  } catch (error) {
    sendJson(res, 502, { message: 'Could not reach Discord API', error: error.message });
  }
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { message: 'Method not allowed' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { message: 'Invalid URL' });
  }
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { message: 'Forbidden' });
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return sendJson(res, 404, { message: 'Not found' });
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/discord') return handleDiscord(req, res, url);
  serveStatic(req, res, url);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Discord control panel is running on port ${PORT}`);
});
