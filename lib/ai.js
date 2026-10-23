import { callClaude } from './providers/claude.js';
import { callGemini } from './providers/gemini.js';
import {
  PARSE_SYSTEM, MAP_SYSTEM, PROFILE_SCHEMA, MAPPING_SCHEMA, PROFILE_TEMPLATE, buildParsePrompt, buildMapPrompt
} from './prompts.js';

export const DEFAULT_MODELS = { claude: 'claude-haiku-4-5-20251001', gemini: 'gemini-3.8-flash' };

const RETRY_DELAYS = [3000, 6000, 12000, 24000];
const RETRYABLE_RE = /\b(429|500|502|503|504|529)\b|overloaded|high demand|UNAVAILABLE|RESOURCE_EXHAUSTED|Failed to fetch/i;

export async function getSettings() {
  const { cvfill_provider, cvfill_keys, cvfill_models } = await chrome.storage.local.get([
    'cvfill_provider', 'cvfill_keys', 'cvfill_models'
  ]);
  const provider = cvfill_provider || 'claude';
  const keys = cvfill_keys || {};
  const models = { ...DEFAULT_MODELS, ...(cvfill_models || {}) };
  return { provider, keys, models, apiKey: keys[provider], model: models[provider] || DEFAULT_MODELS[provider] };
}

async function call({ onRetry, ...opts }) {
  const { provider, apiKey, model } = await getSettings();
  if (!apiKey) throw new Error(`Falta la API key de ${provider}. Configurala en "Configuración IA".`);
  const send = provider === 'gemini' ? callGemini : callClaude;
  for (let attempt = 0; ; attempt++) {
    try {
      return extractJSON(await send({ apiKey, model, ...opts }));
    } catch (e) {
      const delay = RETRY_DELAYS[attempt];
      if (delay == null || !RETRYABLE_RE.test(e.message)) throw e;
      onRetry?.({ attempt: attempt + 1, max: RETRY_DELAYS.length, delay, error: e.message });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export function extractJSON(text) {
  const clean = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf('{');
  if (start < 0) throw new Error('La IA no devolvió JSON');
  // Balanced-brace scan that respects strings, to cut the first complete object
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i++) {
    const c = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error('JSON incompleto en la respuesta de la IA');
}

export function normalizeProfile(p) {
  const out = structuredClone(PROFILE_TEMPLATE);
  out.personal = { ...out.personal, ...(p?.personal || {}) };
  out.summary = p?.summary ?? null;
  for (const k of ['experience', 'education', 'languages', 'skills', 'links']) {
    out[k] = Array.isArray(p?.[k]) ? p[k] : [];
  }
  return out;
}

// Embedded PDF links (e.g. icon-only LinkedIn/GitHub) are invisible to the model, so assign them deterministically too
function applyLinks(profile, links) {
  const p = profile.personal;
  const rules = [['linkedin', /linkedin\.com/i], ['github', /github\.com/i]];
  for (const url of links) {
    const rule = rules.find(([, re]) => re.test(url));
    if (rule) { if (!p[rule[0]]) p[rule[0]] = url; continue; }
    if (/^mailto:/i.test(url)) { if (!p.email) p.email = url.slice(7).split('?')[0]; continue; }
    if (/^tel:|wa\.me\//i.test(url)) continue;
    if (!profile.links.includes(url) && url !== p.website) profile.links.push(url);
  }
  return profile;
}

export async function parseCV(pdfBase64, { links = [], onRetry } = {}) {
  const raw = await call({
    system: PARSE_SYSTEM, text: buildParsePrompt(links), pdfBase64, schema: PROFILE_SCHEMA, maxTokens: 16000, onRetry
  });
  return applyLinks(normalizeProfile(raw), links);
}

export async function mapFields(fields, profile, { imageBase64, onRetry } = {}) {
  const raw = await call({
    system: MAP_SYSTEM, text: buildMapPrompt(fields, profile), imageBase64, schema: MAPPING_SCHEMA, maxTokens: 16000, onRetry
  });
  return {
    mappings: Array.isArray(raw?.mappings) ? raw.mappings : [],
    unfilled: Array.isArray(raw?.unfilled) ? raw.unfilled : []
  };
}
