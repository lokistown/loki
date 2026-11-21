// Loki publishes his projects as their own GitHub repos in the lokistown organisation.
const API = 'https://api.github.com';
const ORG = process.env.LOKI_ORG || 'lokistown';

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'loki-brain' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const e = new Error(`GitHub ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return text ? JSON.parse(text) : null;
}

export async function publishRepo(name, description, homepage, files) {
  if (!process.env.GH_TOKEN) return null;
  try {
    await gh(`/orgs/${ORG}/repos`, { method: 'POST', body: { name, description: description.slice(0, 300), homepage, has_issues: false, has_wiki: false, auto_init: false } });
  } catch (e) {
    if (e.status !== 422) throw e; // 422 = already exists, then we just update files
  }
  for (const f of files) {
    let sha;
    try {
      sha = (await gh(`/repos/${ORG}/${name}/contents/${encodeURIComponent(f.path)}`)).sha;
    } catch {}
    await gh(`/repos/${ORG}/${name}/contents/${encodeURIComponent(f.path)}`, { method: 'PUT', body: { message: f.message || `Loki: ${f.path}`, content: Buffer.from(f.content).toString('base64'), ...(sha ? { sha } : {}), committer: { name: 'Loki', email: 'loki@users.noreply.github.com' } } });
  }
  return `https://github.com/${ORG}/${name}`;
}
