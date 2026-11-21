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
  const out = [];
  for (const i of issues.filter((x) => !x.pull_request)) {
    const isRequest = (i.labels || []).some((l) => l.name === 'loki-request');
    let body = (i.body || '').slice(0, 2000);
    if (isRequest) {
      // Loki's own request: only act once the human has replied in a comment
      if (!i.comments) continue;
      const comments = await gh(`/repos/${REPO}/issues/${i.number}/comments?per_page=10`);
      const human = comments.filter((c) => !String(c.body || '').startsWith('🐱'));
      if (!human.length) continue;
      body = `Your request was: ${body.split('\n')[0]}\nYour human replied: ${human.map((c) => c.body).join('\n').slice(0, 1500)}`;
    }
    out.push({ number: i.number, title: i.title, body, wishId: ((i.body || '').match(/wish:([a-z0-9-]+)/) || [])[1] || null });
  }
  return out;
}

// Loki asks his human for something: a GitHub issue (GitHub emails the owner about it).
export async function notifyOwner(title, body) {
  // phone push via ntfy.sh (free, no account): install the ntfy app and subscribe to your private topic
  const topic = process.env.LOKI_NTFY_TOPIC;
  if (topic) {
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { Title: title.replace(/[^ -~]/g, '').trim() || 'Loki needs you', Tags: 'cat', Click: `https://github.com/${REPO}/issues` },
        body: body.slice(0, 1000),
      });
    } catch (e) {
      console.warn('ntfy failed:', e.message);
    }
  }
  if (!process.env.GH_TOKEN) return false;
  try {
    try {
      await gh(`/repos/${REPO}/labels/loki-request`);
    } catch {
      await gh(`/repos/${REPO}/labels`, { method: 'POST', body: { name: 'loki-request', color: '2a9d8f', description: 'Loki needs something from his human' } }).catch(() => {});
    }
    await gh(`/repos/${REPO}/issues`, { method: 'POST', body: { title, body, labels: ['loki-request', 'gift'] } });
    return true;
  } catch (e) {
    console.warn('notify failed:', e.message);
    return false;
  }
}

export async function answerGift(number, reply) {
  await gh(`/repos/${REPO}/issues/${number}/comments`, { method: 'POST', body: { body: `🐱 **Loki:** ${reply}` } });
  await gh(`/repos/${REPO}/issues/${number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });
}
