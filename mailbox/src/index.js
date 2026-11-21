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

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
    try {
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

      // ---------- Loki's brain only ----------
      if (p.startsWith('/admin/')) {
        if (!env.ADMIN_TOKEN || req.headers.get('authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json(req, { error: 'no' }, 401);
        if (p === '/admin/pending') {
          const limit = Math.min(30, Number(url.searchParams.get('limit')) || 15);
          const { results } = await env.DB.prepare("SELECT id, visitor_id, nick, text, has_image, created FROM offerings WHERE status = 'pending' ORDER BY created ASC LIMIT ?").bind(limit).all();
          return json(req, { items: results.map((r) => ({ id: r.id, visitorId: r.visitor_id, nick: r.nick, text: r.text, hasImage: !!r.has_image, created: r.created })) });
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
