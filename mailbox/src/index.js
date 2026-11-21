// Loki's mailbox: a tiny Cloudflare Worker + D1 database (free tier).
// Visitors leave messages/pictures; only things Loki KEPT are shown publicly.
// Loki's brain reads pending ones and resolves them with a secret token.

const ORIGINS = ['https://lokistown.github.io', 'http://localhost:8765'];
const MAX_TEXT = 500;
const MAX_IMAGE = 400_000; // bytes after base64 decode
const PER_HOUR = 5;

function cors(req) {
  const o = req.headers.get('origin') || '';
  return {
    'access-control-allow-origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'origin',
  };
}
const json = (req, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...cors(req) } });

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// Backup alarm clock: every 30 minutes, wake Loki if GitHub's own scheduler missed his session.
async function wakeLoki(env) {
  if (!env.GH_DISPATCH_TOKEN) return;
  const h = { authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'loki-alarm' };
  const r = await fetch('https://api.github.com/repos/lokistown/loki/actions/runs?per_page=1', { headers: h });
  const last = (await r.json()).workflow_runs?.[0];
  const age = last ? Date.now() - new Date(last.created_at).getTime() : Infinity;
  if (last && (last.status !== 'completed' || age < 25 * 60000)) return; // running or recent enough
  await fetch('https://api.github.com/repos/lokistown/loki/actions/workflows/session.yml/dispatches', { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
}


// ---------- Live town: who is walking around right now (one Durable Object, WebSocket hibernation) ----------
const DEFAULT_TOWN = { multiplayer: true, showCount: true, throwing: true };
const KINDS = ['yarn', 'plane', 'flower', 'snow', 'pillow', 'fish'];
const MAX_PEOPLE = 80;
const num = (v, lim) => Math.max(-lim, Math.min(lim, Math.round((Number(v) || 0) * 100) / 100));
export class Town {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async settings() {
    return { ...DEFAULT_TOWN, ...((await this.ctx.storage.get('settings')) || {}) };
  }
  people(except) {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === 1 && w.deserializeAttachment()?.nick);
  }
  send(ws, m) {
    try { ws.send(JSON.stringify(m)); } catch {}
  }
  broadcast(m, except) {
    const s = JSON.stringify(m);
    for (const w of this.people(except)) try { w.send(s); } catch {}
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/settings')) {
      let s = await this.settings();
      if (req.method === 'POST') {
        const b = await req.json().catch(() => ({}));
        for (const k of Object.keys(DEFAULT_TOWN)) if (typeof b[k] === 'boolean') s[k] = b[k];
        await this.ctx.storage.put('settings', s);
        if (!s.multiplayer) for (const w of this.ctx.getWebSockets()) try { w.close(4000, 'off'); } catch {}
        else this.broadcast({ t: 'settings', settings: s, online: this.people().length });
      }
      return new Response(JSON.stringify({ ...s, online: s.multiplayer ? this.people().length : 0 }), { headers: { 'content-type': 'application/json' } });
    }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const s = await this.settings();
    if (!s.multiplayer || this.ctx.getWebSockets().length >= MAX_PEOPLE) return new Response('closed', { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8), nick: '', c: 0, p: [0, 0, 6, 0, 0], win: 0, n: 0, last: 0 });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 400) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const a = ws.deserializeAttachment();
    const now = Date.now();
    if (now - a.win > 1000) { a.win = now; a.n = 0; }
    if (++a.n > 20) return; // too chatty
    if (m.t === 'hello') {
      const first = !a.nick;
      a.nick = String(m.nick || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) || 'visitor';
      a.c = Math.abs(Math.floor(Number(m.c) || 0)) % 7;
      if (Array.isArray(m.p)) a.p = [num(m.p[0], 2000), num(m.p[1], 300), num(m.p[2], 2000), num(m.p[3], 10), m.p[4] ? 1 : 0];
      ws.serializeAttachment(a);
      const s = await this.settings();
      const others = this.people(ws).map((w) => { const o = w.deserializeAttachment(); return { id: o.id, nick: o.nick, c: o.c, p: o.p }; });
      this.send(ws, { t: 'init', you: a.id, peers: others, settings: s, online: others.length + 1 });
      this.broadcast({ t: 'join', id: a.id, nick: a.nick, c: a.c, p: a.p, online: others.length + 1, first }, ws);
      return;
    }
    if (!a.nick) return;
    if (m.t === 'p' && Array.isArray(m.p)) {
      a.p = [num(m.p[0], 2000), num(m.p[1], 300), num(m.p[2], 2000), num(m.p[3], 10), m.p[4] ? 1 : 0];
      ws.serializeAttachment(a);
      this.broadcast({ t: 'p', id: a.id, p: a.p }, ws);
    } else if (m.t === 'hi' || m.t === 'throw') {
      if (now - a.last < 1200) return; // one hi/throw per 1.2 s
      a.last = now;
      ws.serializeAttachment(a);
      const to = String(m.to || '').slice(0, 8);
      if (m.t === 'hi') return this.broadcast({ t: 'hi', id: a.id, to }, ws);
      if (!(await this.settings()).throwing) return;
      const k = KINDS.includes(m.k) ? m.k : 'yarn';
      if (!this.people(ws).some((w) => w.deserializeAttachment().id === to)) return;
      this.broadcast({ t: 'throw', id: a.id, to, k }, ws);
    }
  }
  async webSocketClose(ws) {
    this.gone(ws);
    try { ws.close(1000, 'bye'); } catch {}
  }
  async webSocketError(ws) {
    this.gone(ws);
  }
  gone(ws) {
    const a = ws.deserializeAttachment();
    if (a?.nick) this.broadcast({ t: 'leave', id: a.id, online: this.people(ws).length }, ws);
  }
}
const town = (env) => env.TOWN.get(env.TOWN.idFromName('main'));

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(wakeLoki(env));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    try {
      // ---------- live town ----------
      if (p === '/town/ws') {
        const o = req.headers.get('origin') || '';
        if (o && !ORIGINS.includes(o)) return new Response('no', { status: 403 });
        return town(env).fetch(req);
      }
      if (p === '/api/town' && req.method === 'GET') {
        const r = await town(env).fetch(new Request('https://town/settings'));
        return json(req, await r.json());
      }
      // ---------- public ----------
      if (p === '/api/offer' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        const visitorId = String(body.visitorId || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
        const nick = String(body.nick || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 24) || 'someone';
        const text = String(body.text || '').trim().slice(0, MAX_TEXT);
        let image = null, mime = null;
        if (body.image) {
          const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image));
          if (!m) return json(req, { error: 'bad image' }, 400);
          image = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
          mime = m[1];
          if (image.length > MAX_IMAGE) return json(req, { error: 'picture too big' }, 413);
        }
        if (visitorId.length < 12) return json(req, { error: 'bad visitor' }, 400);
        if (!text && !image) return json(req, { error: 'empty' }, 400);
        const ipHash = await sha((req.headers.get('cf-connecting-ip') || '') + (env.SALT || 'loki'));
        const since = Date.now() - 3600_000;
        const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM offerings WHERE (visitor_id = ? OR ip_hash = ?) AND created > ?').bind(visitorId, ipHash, since).first();
        if (n >= PER_HOUR) return json(req, { error: 'Loki can only read 5 things from you per hour. Try again later!' }, 429);
        const oid = id();
        await env.DB.prepare('INSERT INTO offerings (id, visitor_id, nick, text, has_image, created, status, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(oid, visitorId, nick, text, image ? 1 : 0, Date.now(), 'pending', ipHash).run();
        if (image) await env.DB.prepare('INSERT INTO images (id, mime, data) VALUES (?, ?, ?)').bind(oid, mime, image).run();
        return json(req, { ok: true, id: oid });
      }
      if (p === '/api/offerings' && req.method === 'GET') {
        const limit = Math.min(60, Number(url.searchParams.get('limit')) || 30);
        const { results } = await env.DB.prepare("SELECT id, nick, text, has_image, created, status, reply, question FROM offerings WHERE status = 'kept' ORDER BY resolved DESC LIMIT ?").bind(limit).all();
        const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM offerings WHERE status = 'pending'").first();
        const base = `${url.origin}/api/image/`;
        return json(req, { pending: n, items: results.map((r) => ({ id: r.id, nick: r.nick, text: r.text, image: r.has_image ? base + r.id : null, created: r.created, status: r.status, reply: r.reply, question: r.question })) });
      }
      if (p.startsWith('/api/image/')) {
        const oid = p.split('/').pop();
        const row = await env.DB.prepare("SELECT i.mime, i.data FROM images i JOIN offerings o ON o.id = i.id WHERE i.id = ? AND o.status = 'kept'").bind(oid).first();
        if (!row) return new Response('not found', { status: 404, headers: cors(req) });
        return new Response(new Uint8Array(row.data), { headers: { 'content-type': row.mime, 'cache-control': 'public, max-age=86400', ...cors(req) } });
      }
      if (p === '/api/me' && req.method === 'GET') {
        const visitorId = String(url.searchParams.get('visitorId') || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
        const { results } = await env.DB.prepare('SELECT id, text, has_image, created, status, reply, question FROM offerings WHERE visitor_id = ? ORDER BY created DESC LIMIT 30').bind(visitorId).all();
        return json(req, { items: results, kept: results.filter((r) => r.status === 'kept').length });
      }

      // ---------- shop webhooks: Ko-fi and Gumroad report every sale/tip here ----------
      if (p === '/hooks/kofi' && req.method === 'POST') {
        const form = await req.formData();
        const d = JSON.parse(String(form.get('data') || '{}'));
        const verified = env.KOFI_TOKEN ? d.verification_token === env.KOFI_TOKEN : false;
        if (env.KOFI_TOKEN && !verified) return new Response('no', { status: 401 });
        const items = Array.isArray(d.shop_items) ? d.shop_items.map((i) => i.direct_link_code || i.variation_name || 'item').join(', ') : '';
        await env.DB.prepare('INSERT OR IGNORE INTO sales (id, source, type, amount, currency, product, from_name, message, is_public, created, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(`kofi-${d.message_id || d.kofi_transaction_id || Date.now()}`, 'kofi', String(d.type || 'Donation'), Number(d.amount) || 0, String(d.currency || 'USD'), items || String(d.tier_name || ''), d.is_public ? String(d.from_name || '').slice(0, 40) : '', d.is_public ? String(d.message || '').slice(0, 300) : '', d.is_public ? 1 : 0, Date.now(), verified ? 1 : 0).run();
        return new Response('ok');
      }
      if (p === '/hooks/gumroad' && req.method === 'POST') {
        const f = await req.formData();
        if (env.GUMROAD_SELLER && f.get('seller_id') !== env.GUMROAD_SELLER) return new Response('no', { status: 401 });
        await env.DB.prepare('INSERT OR IGNORE INTO sales (id, source, type, amount, currency, product, from_name, message, is_public, created, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(`gumroad-${f.get('sale_id') || Date.now()}`, 'gumroad', f.get('test') === 'true' ? 'Test sale' : 'Sale', (Number(f.get('price')) || 0) / 100, String(f.get('currency') || 'usd').toUpperCase(), String(f.get('product_name') || '').slice(0, 80), '', '', 0, Date.now(), env.GUMROAD_SELLER ? 1 : 0).run();
        return new Response('ok');
      }

      // ---------- Loki's brain only ----------
      if (p.startsWith('/admin/')) {
        const given = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        if (!env.ADMIN_TOKEN || !given || given !== String(env.ADMIN_TOKEN).trim()) return json(req, { error: "no" }, 401);
        if (p === '/admin/pending') {
          const limit = Math.min(30, Number(url.searchParams.get('limit')) || 15);
          const { results } = await env.DB.prepare("SELECT id, visitor_id, nick, text, has_image, created FROM offerings WHERE status = 'pending' ORDER BY created ASC LIMIT ?").bind(limit).all();
          return json(req, { items: results.map((r) => ({ id: r.id, visitorId: r.visitor_id, nick: r.nick, text: r.text, hasImage: !!r.has_image, created: r.created })) });
        }
        if (p === '/admin/town') {
          const r = await town(env).fetch(new Request('https://town/settings', { method: req.method === 'POST' ? 'POST' : 'GET', body: req.method === 'POST' ? await req.text() : undefined }));
          return json(req, await r.json());
        }
        if (p === '/admin/sales') {
          const since = Number(url.searchParams.get('since')) || 0;
          const { results } = await env.DB.prepare('SELECT * FROM sales WHERE created > ? ORDER BY created ASC LIMIT 100').bind(since).all();
          return json(req, { items: results });
        }
        if (p === '/admin/resolve' && req.method === 'POST') {
          const { items = [] } = await req.json();
          const now = Date.now();
          const stmts = items.slice(0, 50).map((it) =>
            env.DB.prepare('UPDATE offerings SET status = ?, reply = ?, question = ?, resolved = ? WHERE id = ?').bind(it.status === 'kept' ? 'kept' : 'letgo', String(it.reply || '').slice(0, 400), String(it.question || '').slice(0, 200), now, String(it.id)),
          );
          if (stmts.length) await env.DB.batch(stmts);
          // pictures Loki let go are deleted
          await env.DB.prepare("DELETE FROM images WHERE id IN (SELECT id FROM offerings WHERE status = 'letgo')").run();
          return json(req, { ok: true, resolved: stmts.length });
        }
      }
      return json(req, { error: 'not found' }, 404);
    } catch (e) {
      return json(req, { error: 'server error' }, 500);
    }
  },
};
