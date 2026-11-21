// Gifts and notes from Loki's human arrive as GitHub issues labelled "gift" in the private
// loki-memory repo (the Control Centre creates them). Loki reads them, thanks, and closes them.
const API = 'https://api.github.com';
const REPO = process.env.LOKI_MEMORY_REPO || 'lokistown/loki-memory';

async function gh(path, { method = 'GET', body } = {}) {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('no GH_TOKEN');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'loki-brain' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

export async function ensureGiftLabel() {
  try {
    await gh(`/repos/${REPO}/labels/gift`);
  } catch {
    try {
      await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name: 'gift', color: 'f28c28', description: 'A gift or note for Loki' } });
    } catch {}
  }
}

export async function fetchGifts() {
  if (!process.env.GH_TOKEN) return [];
  const issues = await gh(`/repos/${REPO}/issues?state=open&labels=gift&per_page=10`);
  return issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, body: (i.body || '').slice(0, 2000), wishId: ((i.body || '').match(/wish:([a-z0-9-]+)/) || [])[1] || null }));
}

export async function answerGift(number, reply) {
  await gh(`/repos/${REPO}/issues/${number}/comments`, { method: 'POST', body: { body: `🐱 **Loki:** ${reply}` } });
  await gh(`/repos/${REPO}/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
}
