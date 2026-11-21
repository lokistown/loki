// Talks to free AI providers with automatic fallback.
// Gemini first, then Groq, then OpenRouter free models. Memory is never touched here,
// so switching providers can never affect Loki's progress.
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const resolvedModels = {};

async function http(url, options = {}, timeoutMs = 90_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(t);
  }
}

// ---------- Gemini ----------
// All usable "flash" models, best first. If one is overloaded we try the next.
async function geminiModels(key, preferred) {
  if (resolvedModels.geminiList) return resolvedModels.geminiList;
  // Discover the best live "flash" model so we survive model retirements.
  const data = await http(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/(image|tts|audio|live|thinking-exp|embedding|preview-tts)/.test(n));
  const score = (n) => {
    const v = parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    let s = v * 10;
    if (/lite/.test(n)) s -= 3; // lite = higher free limits but weaker; prefer full flash
    if (/preview|exp/.test(n)) s -= 2;
    if (/latest/.test(n)) s += 1;
    return s;
  };
  names.sort((a, b) => score(b) - score(a));
  const list = [...new Set([preferred, ...names].filter(Boolean))];
  if (!list.length) throw new Error('No Gemini flash model available');
  resolvedModels.geminiList = list.slice(0, 6);
  console.log(`Gemini models to try: ${resolvedModels.geminiList.join(', ')}`);
  return resolvedModels.geminiList;
}
const geminiBad = new Set(); // models that failed this session

async function callGemini(key, model, system, user, json) {
  const models = (await geminiModels(key, model)).filter((m) => !geminiBad.has(m));
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 8192, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  let last;
  for (const m of models) {
    try {
      const data = await http(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned empty response');
      return { text, model: m };
    } catch (e) {
      last = e;
      if (e.status === 401 || e.status === 403) throw e; // bad key: no point trying other models
      console.warn(`gemini ${m} failed (${e.status || e.message}), trying next model`);
      if (e.status === 404 || e.status === 429 || e.status === 503 || e.name === 'AbortError') geminiBad.add(m);
    }
  }
  throw last || new Error('No Gemini model worked');
}

// ---------- OpenAI-compatible (Groq, OpenRouter) ----------
async function openrouterModel(key, preferred) {
  if (preferred) return preferred;
  if (resolvedModels.openrouter) return resolvedModels.openrouter;
  const data = await http('https://openrouter.ai/api/v1/models', { headers: { authorization: `Bearer ${key}` } });
  const free = (data.data || [])
    .filter((m) => m.id.endsWith(':free') && Number(m.pricing?.prompt ?? 1) === 0)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  if (!free.length) throw new Error('No free OpenRouter model');
  resolvedModels.openrouter = free[0].id;
  return free[0].id;
}

async function callOpenAICompat(baseUrl, key, model, system, user, json) {
  const body = {
    model,
    temperature: 0.9,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const data = await http(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Empty response');
  return { text, model };
}

// ---------- Mock (local testing without keys) ----------
import { mockReply } from './mock.js';

// ---------- Public API ----------
export class Brain {
  constructor({ mock = false, maxCalls = config.maxCallsPerSession } = {}) {
    this.mock = mock;
    this.maxCalls = maxCalls;
    this.calls = 0;
    this.dead = new Set(); // providers that hit quota this session
    this.log = [];
  }

  get budgetLeft() {
    return this.maxCalls - this.calls;
  }

  async ask(system, user, { json = false } = {}) {
    if (this.calls >= this.maxCalls) throw new Error('Session AI budget used up');
    this.calls++;
    if (this.mock) {
      const text = mockReply(user, json);
      this.log.push({ provider: 'mock', model: 'mock' });
      return json ? parseJson(text) : text;
    }
    const errors = [];
    for (const p of config.providers) {
      const key = process.env[p.keyEnv];
      if (!key || this.dead.has(p.name)) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let r;
          if (p.name === 'gemini') r = await callGemini(key, p.model, system, user, json);
          else if (p.name === 'groq') r = await callOpenAICompat('https://api.groq.com/openai/v1', key, p.model, system, user, json);
          else r = await callOpenAICompat('https://openrouter.ai/api/v1', key, await openrouterModel(key, p.model), system, user, json);
          this.log.push({ provider: p.name, model: r.model });
          return json ? parseJson(r.text) : r.text.trim();
        } catch (e) {
          errors.push(`${p.name}: ${e.message}`);
          if (e.status === 429 || e.status === 403 || e.status === 401) {
            this.dead.add(p.name); // quota / key problem: move on to the next provider
            break;
          }
          if (e instanceof SyntaxError) break; // bad JSON: try next provider
          await sleep(3000 * (attempt + 1));
        }
      }
    }
    const err = new Error(`All AI providers failed:\n  ${errors.join('\n  ') || 'no API keys set'}`);
    err.allFailed = true;
    throw err;
  }
}

export function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new SyntaxError('Could not parse JSON from AI reply');
  }
}
