// Loki's own shop on Stripe: when he finishes a product he lists it himself.
// 1) the product's zip goes into his mailbox worker (private, only buyers can download it)
// 2) Stripe gets a product, a price and a Payment Link
// 3) after paying, Stripe sends the buyer to the worker's thank-you page, which checks the
//    payment with Stripe and hands over the download; the sale lands in Loki's wallet.
// Needs the GitHub secret STRIPE_SECRET_KEY (a restricted key is best) and the same key in the worker.
import fs from 'node:fs';

const API = 'https://api.stripe.com/v1';
export const stripeReady = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.LOKI_WORKER_URL && !!process.env.LOKI_WORKER_SECRET;
export const stripeMode = () => (/_test_/.test(process.env.STRIPE_SECRET_KEY || '') ? 'test' : 'live');

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(path, params, method = 'POST') {
  const r = await fetch(`${API}${path}${method === 'GET' && params ? `?${form(params)}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
    body: method === 'GET' ? undefined : form(params || {}),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe ${path}: ${j.error?.message || r.status}`);
  return j;
}
async function worker(path, body) {
  const r = await fetch(`${process.env.LOKI_WORKER_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${String(process.env.LOKI_WORKER_SECRET).trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`mailbox ${path}: ${j.error || r.status}`);
  return j;
}

// Lists one product. Returns the Payment Link URL.
export async function listOnStripe(mem, product) {
  const zipPath = mem.p(product.file);
  if (!fs.existsSync(zipPath)) throw new Error(`no zip for ${product.title}`);
  const zip = fs.readFileSync(zipPath);
  if (zip.length > 1_800_000) throw new Error('product file too big for the mailbox (max 1.8 MB)');
  const cents = Math.max(100, Math.round(Number(product.price || 3) * 100));
  const mode = stripeMode();
  const sp = await stripe('/products', {
    name: product.title.slice(0, 120),
    description: (product.description || product.title).slice(0, 500),
    metadata: { loki_id: product.id, type: product.type },
    ...(product.cover ? { images: { 0: product.cover } } : {}),
  });
  const price = await stripe('/prices', { product: sp.id, unit_amount: cents, currency: 'usd' });
  const link = await stripe('/payment_links', {
    line_items: { 0: { price: price.id, quantity: 1 } },
    after_completion: { type: 'redirect', redirect: { url: `${process.env.LOKI_WORKER_URL}/shop/thanks?session_id={CHECKOUT_SESSION_ID}` } },
    metadata: { loki_id: product.id },
    submit_type: 'pay',
  });
  await worker('/admin/product', { id: product.id, link: link.id, title: product.title, price: cents / 100, name: `${product.id}.zip`, data: zip.toString('base64'), mode });
  Object.assign(product, { status: 'listed', url: link.url, shop: 'stripe', stripe: { product: sp.id, price: price.id, link: link.id, mode }, listed: new Date().toISOString().slice(0, 10) });
  return link.url;
}

// Lists products that are ready but not on sale yet (a few per session).
export async function listReadyProducts(mem, max = 2) {
  if (!stripeReady()) return [];
  const products = mem.list('products.json');
  const out = [];
  for (const p of products.filter((x) => x.status === 'ready' && !x.stripe).slice(0, max)) {
    try {
      await listOnStripe(mem, p);
      out.push(p);
    } catch (e) {
      p.listError = String(e.message).slice(0, 200);
      mem.event('stripe_error', { summary: `${p.title}: ${p.listError}` });
    }
  }
  mem.saveList('products.json', products, 300);
  return out;
}
