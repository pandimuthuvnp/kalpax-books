// KalpaX Books server for Render (or any Node host).
// Serves the static site and proxies the AI chat so the API key stays on the server.
// Env vars:
//   AI_API_KEY  Groq key (gsk_...) or xAI Grok key (xai-...). Leave unset/placeholder to disable server AI.
//   AI_MODEL    optional model override
//   PORT        set by Render
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
// never serve server-side or secret files
const BLOCKED = new Set(['server.js', 'package.json', 'config.local.js', '.gitignore', 'render.yaml']);

function provider() {
  const key = (process.env.AI_API_KEY || '').trim();
  if (key.startsWith('gsk_')) return { key, name: 'Groq', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' };
  if (key.startsWith('xai-')) return { key, name: 'Grok', url: 'https://api.x.ai/v1/chat/completions', model: 'grok-3-mini' };
  return null;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function chat(req, res) {
  const p = provider();
  if (!p) return send(res, 503, { error: 'AI_API_KEY is not set on the server' });
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 200000) return send(res, 413, { error: 'too large' }); }
  let messages;
  try { messages = JSON.parse(raw).messages; } catch { return send(res, 400, { error: 'bad JSON' }); }
  if (!Array.isArray(messages)) return send(res, 400, { error: 'messages required' });
  try {
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({ model: process.env.AI_MODEL || p.model, messages: messages.slice(-12), temperature: 0.4 })
    });
    const j = await r.json();
    if (!r.ok) return send(res, 502, { error: j.error?.message || j.error || 'HTTP ' + r.status });
    send(res, 200, { reply: j.choices?.[0]?.message?.content || '', provider: p.name });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/config') { const p = provider(); return send(res, 200, { serverAI: !!p, provider: p?.name || null }); }
  if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, res);

  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || BLOCKED.has(path.basename(file)) || rel.startsWith('.git')) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`KalpaX Books on :${PORT} — server AI: ${provider()?.name || 'off'}`));
