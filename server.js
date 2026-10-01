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

// models the key can actually use, best first, read once from the provider's /models list
const PREFER = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b', 'llama-3.1-8b-instant', 'grok-4-fast', 'grok-4', 'grok-3-mini', 'grok-3'];
let candidates = null;   // ordered model ids to try
let pickedModel = null;  // last one that worked
async function modelList(p) {
  if (process.env.AI_MODEL) return [process.env.AI_MODEL];
  if (candidates) return candidates;
  try {
    const r = await fetch(p.url.replace('/chat/completions', '/models'), { headers: { Authorization: 'Bearer ' + p.key } });
    const ids = ((await r.json()).data || []).filter(m => m.active !== false).map(m => m.id)
      .filter(id => !/whisper|tts|guard|embed|image|playai|orpheus|safeguard|compound|allam/i.test(id));
    candidates = [...PREFER.filter(id => ids.includes(id)), ...ids.filter(id => !PREFER.includes(id))];
    console.log('AI models available:', candidates.join(', '));
  } catch (e) { console.log('model list failed:', e.message); }
  if (!candidates || !candidates.length) candidates = [p.model];
  return candidates;
}

async function chat(req, res) {
  const p = provider();
  if (!p) return send(res, 503, { error: 'AI_API_KEY is not set on the server' });
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 200000) return send(res, 413, { error: 'too large' }); }
  let messages;
  try { messages = JSON.parse(raw).messages; } catch { return send(res, 400, { error: 'bad JSON' }); }
  if (!Array.isArray(messages)) return send(res, 400, { error: 'messages required' });
  const call = async model => {
    const r = await fetch(p.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key },
      body: JSON.stringify({ model, messages: messages.slice(-12), temperature: 0.4 })
    });
    return { r, j: await r.json() };
  };
  try {
    const list = await modelList(p);
    const order = pickedModel ? [pickedModel, ...list.filter(m => m !== pickedModel)] : list;
    let r, j, model;
    // try up to 5 models: skip ones this key can't use (retired / no access)
    for (model of order.slice(0, 5)) {
      ({ r, j } = await call(model));
      if (r.ok) { pickedModel = model; break; }
      if (!/model|access|not found|does not exist/i.test(j.error?.message || '')) break;
      console.log('model', model, 'refused:', j.error?.message);
    }
    if (!r.ok) return send(res, 502, { error: j.error?.message || j.error || 'HTTP ' + r.status });
    send(res, 200, { reply: j.choices?.[0]?.message?.content || '', provider: p.name, model });
  } catch (e) {
    send(res, 502, { error: e.message });
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/config') { const p = provider(); return send(res, 200, { serverAI: !!p, provider: p?.name || null, model: process.env.AI_MODEL || pickedModel || null }); }
  if (url.pathname === '/api/chat' && req.method === 'POST') return chat(req, res);

  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || BLOCKED.has(path.basename(file)) || rel.startsWith('.git')) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=300' });
    res.end(data);
  });
}).listen(PORT, () => { console.log(`KalpaX Books on :${PORT} — server AI: ${provider()?.name || 'off'}`); if (provider()) modelList(provider()); });
