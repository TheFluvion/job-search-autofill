import { parseCV, mapFields, getSettings, normalizeProfile, DEFAULT_MODELS } from './lib/ai.js';
import { scanFields } from './lib/scanner.js';
import { fillFields, clickAdd, focusField } from './lib/filler.js';
import { extractPdfLinks } from './lib/pdf-links.js';

const MAX_ADD_ITERATIONS = 10;
const MAX_FIELDS = 300;
const MAX_STEP_FIELDS = 25;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(id, msg, isError = false) {
  const el = $(id);
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

function retryMessage({ attempt, max, delay }, prefix = '') {
  return `${prefix}La IA está saturada, reintentando en ${delay / 1000}s (${attempt}/${max})...`;
}

// ---------- Settings ----------

async function loadSettings() {
  const { provider, keys, models } = await getSettings();
  $('provider').value = provider;
  $('apiKey').value = keys[provider] || '';
  $('model').value = models[provider];
  if (!keys[provider]) $('settingsBox').open = true;
}

$('provider').addEventListener('change', async () => {
  const p = $('provider').value;
  const { keys, models } = await getSettings();
  $('apiKey').value = keys[p] || '';
  $('model').value = models[p] || DEFAULT_MODELS[p];
});

$('saveSettings').addEventListener('click', async () => {
  const provider = $('provider').value;
  const { keys, models } = await getSettings();
  keys[provider] = $('apiKey').value.trim();
  models[provider] = $('model').value.trim() || DEFAULT_MODELS[provider];
  await chrome.storage.local.set({ cvfill_provider: provider, cvfill_keys: keys, cvfill_models: models });
  setStatus('settingsStatus', 'Guardado');
});

// ---------- CV ----------

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function loadProfile() {
  const { cvfill_profile } = await chrome.storage.local.get('cvfill_profile');
  if (cvfill_profile) $('profile').value = JSON.stringify(cvfill_profile, null, 2);
}

$('parseBtn').addEventListener('click', async () => {
  const file = $('cvFile').files[0];
  if (!file) return setStatus('cvStatus', 'Elegí un PDF primero', true);
  $('parseBtn').disabled = true;
  setStatus('cvStatus', 'Parseando CV...');
  try {
    const links = await extractPdfLinks(await file.arrayBuffer()).catch(() => []);
    const profile = await parseCV(await readFileBase64(file), {
      links,
      onRetry: (r) => setStatus('cvStatus', retryMessage(r))
    });
    $('profile').value = JSON.stringify(profile, null, 2);
    setStatus('cvStatus', 'Listo. Revisá el perfil y tocá "Guardar perfil".');
  } catch (e) {
    setStatus('cvStatus', e.message, true);
  } finally {
    $('parseBtn').disabled = false;
  }
});

$('saveProfile').addEventListener('click', async () => {
  try {
    const profile = normalizeProfile(JSON.parse($('profile').value));
    await chrome.storage.local.set({ cvfill_profile: profile });
    $('profile').value = JSON.stringify(profile, null, 2);
    setStatus('cvStatus', 'Perfil guardado');
  } catch (e) {
    setStatus('cvStatus', `JSON inválido: ${e.message}`, true);
  }
});

// ---------- Fill ----------

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || '')) {
    throw new Error('Abrí el formulario en una pestaña web normal');
  }
  return tab;
}

async function scanAll(tabId) {
  const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanFields });
  const scan = { fields: [], addButtons: [], counts: { experience: 0, education: 0 } };
  for (const { frameId, result } of results) {
    if (!result) continue;
    for (const f of result.fields) scan.fields.push({ ...f, id: `${frameId}:${f.id}`, frameId, localId: f.id });
    for (const b of result.addButtons) scan.addButtons.push({ ...b, frameId });
    scan.counts.experience += result.counts.experience;
    scan.counts.education += result.counts.education;
  }
  return scan;
}

async function runInFrame(tabId, frameId, func, args) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, func, args });
  return res?.result;
}

// Clicks "Add" buttons until there are enough experience/education blocks for the profile
async function ensureBlocks(tabId, scan, profile) {
  for (const kind of ['experience', 'education']) {
    const needed = (profile[kind] || []).length;
    for (let i = 0; i < MAX_ADD_ITERATIONS && scan.counts[kind] < needed; i++) {
      const btn = scan.addButtons.find((b) => b.kind === kind);
      if (!btn) break;
      setStatus('fillStatus', `Agregando bloque de ${kind === 'experience' ? 'experiencia' : 'educación'}...`);
      const before = scan.counts[kind];
      await runInFrame(tabId, btn.frameId, clickAdd, [btn.id]);
      await sleep(800);
      scan = await scanAll(tabId);
      if (scan.counts[kind] <= before) break;
    }
  }
  return scan;
}

function fieldForAI(f) {
  const out = { id: f.id, type: f.type, label: f.label };
  for (const k of ['name', 'autocomplete', 'placeholder', 'section', 'value']) if (f[k]) out[k] = f[k];
  if (f.block != null) out.block = f.block;
  if (f.required) out.required = true;
  if (f.options?.length) out.options = f.options;
  return out;
}

async function captureScreenshot(windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 60 });
    return dataUrl.split(',')[1];
  } catch {
    return undefined;
  }
}

function stepTitle(f) {
  const base = (f.section || 'Formulario').slice(0, 40);
  return f.block != null ? `${base} #${f.block + 1}` : base;
}

// Groups fields by section/block in page order, merging small groups so each AI call stays small
function buildSteps(fields) {
  const groups = [];
  for (const f of fields) {
    const key = `${f.frameId}|${f.section}|${f.block ?? ''}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.fields.push(f);
    else groups.push({ key, title: stepTitle(f), fields: [f] });
  }
  const steps = [];
  for (const g of groups) {
    for (let i = 0; i < g.fields.length; i += MAX_STEP_FIELDS) {
      const chunk = g.fields.slice(i, i + MAX_STEP_FIELDS);
      const last = steps[steps.length - 1];
      if (last && last.fields.length + chunk.length <= MAX_STEP_FIELDS) {
        last.fields.push(...chunk);
        if (!last.titles.includes(g.title)) last.titles.push(g.title);
      } else {
        steps.push({ titles: [g.title], fields: chunk });
      }
    }
  }
  return steps;
}

function unfilledEntry(f, reason) {
  return { fieldId: f.id, label: f.label || f.name || f.id, reason };
}

async function applyStep(tabId, fields, ai) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const mapped = new Map();
  for (const m of ai.mappings) {
    if (byId.has(m.fieldId) && m.value != null && String(m.value) !== '' && !mapped.has(m.fieldId)) {
      mapped.set(m.fieldId, m);
    }
  }
  const unfilled = new Map();
  for (const u of ai.unfilled) {
    if (byId.has(u.fieldId) && !mapped.has(u.fieldId)) unfilled.set(u.fieldId, u.reason || 'Sin dato');
  }
  for (const f of fields) {
    if (!mapped.has(f.id) && !unfilled.has(f.id)) unfilled.set(f.id, 'Sin dato en el CV');
  }

  const results = new Map();
  for (const frameId of new Set(fields.map((f) => f.frameId))) {
    const items = [...mapped.values()]
      .filter((m) => byId.get(m.fieldId).frameId === frameId)
      .map((m) => ({ id: byId.get(m.fieldId).localId, value: m.value, confidence: m.confidence }));
    const unfilledIds = [...unfilled.keys()]
      .filter((id) => byId.get(id).frameId === frameId)
      .map((id) => byId.get(id).localId);
    try {
      const res = (await runInFrame(tabId, frameId, fillFields, [items, unfilledIds])) || [];
      for (const r of res) results.set(`${frameId}:${r.id}`, r);
    } catch (e) {
      for (const it of items) results.set(`${frameId}:${it.id}`, { status: 'fail', error: e.message });
    }
  }

  const out = { filled: [], unfilled: [] };
  for (const [id, m] of mapped) {
    const r = results.get(id);
    if (r && r.status !== 'fail') {
      out.filled.push({
        fieldId: id, label: byId.get(id).label, value: m.value, confidence: m.confidence, source: m.source, low: r.status === 'low'
      });
    } else {
      unfilled.set(id, r?.error || 'Error al llenar');
    }
  }
  for (const [id, reason] of unfilled) out.unfilled.push(unfilledEntry(byId.get(id), reason));
  return out;
}

$('fillBtn').addEventListener('click', async () => {
  $('fillBtn').disabled = true;
  try {
    const { cvfill_profile: profile } = await chrome.storage.local.get('cvfill_profile');
    if (!profile) throw new Error('Primero parseá y guardá el perfil del CV');
    const tab = await getActiveTab();

    setStatus('fillStatus', 'Escaneando formulario...');
    let scan = await scanAll(tab.id);
    scan = await ensureBlocks(tab.id, scan, profile);

    const visible = scan.fields.filter((f) => f.visible);
    const fileFields = visible.filter((f) => f.type === 'file');
    const candidates = visible.filter((f) => f.type !== 'file').slice(0, MAX_FIELDS);
    if (!candidates.length) throw new Error('No se encontraron campos en la página');

    const imageBase64 = $('useScreenshot').checked ? await captureScreenshot(tab.windowId) : undefined;
    const report = { url: tab.url, ts: Date.now(), filled: [], unfilled: [] };
    const steps = buildSteps(candidates);
    let failedSteps = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const prefix = `Paso ${i + 1}/${steps.length} (${step.titles.join(', ')}): `;
      setStatus('fillStatus', `${prefix}mapeando ${step.fields.length} campos...`);
      let ai;
      try {
        ai = await mapFields(step.fields.map(fieldForAI), profile, {
          imageBase64,
          onRetry: (r) => setStatus('fillStatus', retryMessage(r, prefix))
        });
      } catch (e) {
        failedSteps++;
        for (const f of step.fields) report.unfilled.push(unfilledEntry(f, `Error IA: ${e.message}`));
        renderReport(report);
        continue;
      }
      setStatus('fillStatus', `${prefix}llenando...`);
      const res = await applyStep(tab.id, step.fields, ai);
      report.filled.push(...res.filled);
      report.unfilled.push(...res.unfilled);
      renderReport(report);
    }

    for (const f of fileFields) report.unfilled.push(unfilledEntry(f, 'Subida de archivos no soportada'));
    await chrome.storage.local.set({ cvfill_last_report: report });
    renderReport(report);
    const summary = `${report.filled.length} llenados, ${report.unfilled.length} sin llenar.`;
    if (failedSteps) setStatus('fillStatus', `${failedSteps}/${steps.length} pasos fallaron. ${summary}`, true);
    else setStatus('fillStatus', `Listo: ${summary}`);
  } catch (e) {
    setStatus('fillStatus', e.message, true);
  } finally {
    $('fillBtn').disabled = false;
  }
});

// ---------- Report ----------

function reportItem(cls, label, meta, fieldId) {
  const li = document.createElement('li');
  li.className = cls;
  const l = document.createElement('div');
  l.className = 'lbl';
  l.textContent = label || '(sin etiqueta)';
  const m = document.createElement('div');
  m.className = 'meta';
  m.textContent = meta;
  li.append(l, m);
  li.addEventListener('click', () => focusInPage(fieldId));
  return li;
}

async function focusInPage(fieldId) {
  try {
    const tab = await getActiveTab();
    const sep = fieldId.indexOf(':');
    const ok = await runInFrame(tab.id, Number(fieldId.slice(0, sep)), focusField, [fieldId.slice(sep + 1)]);
    if (!ok) setStatus('fillStatus', 'El campo ya no está en la página', true);
  } catch (e) {
    setStatus('fillStatus', e.message, true);
  }
}

function renderReport(report) {
  const uList = $('unfilledList');
  const fList = $('filledList');
  uList.replaceChildren();
  fList.replaceChildren();
  if (!report) return;
  $('reportMeta').textContent = `${new Date(report.ts).toLocaleString()} - ${report.url}`;
  for (const u of report.unfilled) uList.append(reportItem('bad', u.label, u.reason, u.fieldId));
  for (const f of report.filled) {
    const conf = f.confidence != null ? ` (${Math.round(f.confidence * 100)}%)` : '';
    fList.append(reportItem(f.low ? 'low' : 'ok', f.label, `${f.value}${conf}${f.source ? ` - ${f.source}` : ''}`, f.fieldId));
  }
}

async function loadReport() {
  const { cvfill_last_report } = await chrome.storage.local.get('cvfill_last_report');
  renderReport(cvfill_last_report);
}

// ---------- Theme ----------

function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  $('themeBtn').textContent = t === 'dark' ? '☀' : '☾';
  $('themeBtn').title = t === 'dark' ? 'Modo claro' : 'Modo oscuro';
}

async function loadTheme() {
  const { cvfill_theme } = await chrome.storage.local.get('cvfill_theme');
  applyTheme(cvfill_theme || 'dark');
}

$('themeBtn').addEventListener('click', async () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await chrome.storage.local.set({ cvfill_theme: next });
});

// ---------- Help modal ----------

function openHelp() {
  const modal = $('helpModal');
  modal.hidden = false;
  modal.classList.add('open');
}

function closeHelp() {
  const modal = $('helpModal');
  modal.classList.remove('open');
  modal.hidden = true;
}

$('helpBtn').addEventListener('click', openHelp);
$('helpClose').addEventListener('click', closeHelp);
$('helpModal').addEventListener('click', (e) => { if (e.target === $('helpModal')) closeHelp(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('helpModal').classList.contains('open')) closeHelp();
});

loadTheme();
loadSettings();
loadProfile();
loadReport();
