// Self-contained: injected via executeScript({ func }), cannot reference outer scope
export function scanFields() {
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'password']);
  const CONTROL_SEL = 'input, select, textarea, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="textbox"]';
  const HEADING_SEL = 'h1, h2, h3, h4, h5, h6, legend, [role="heading"]';
  const EXP_RE = /experien|employ|work|job|position|empleo|trabajo|laboral|puesto|career|carrera profesional/i;
  const EDU_RE = /educa|school|universi|degree|estudio|formaci|academ|colegio|titulo|título/i;
  const COMPANY_RE = /company|employer|organi[sz]ation|empresa|compañ[ií]a|empleador/i;
  const INSTITUTION_RE = /school|institution|universi|college|instituci[oó]n|escuela|colegio/i;
  const ADD_RE = /^\s*(\+\s*)?(add|agregar|añadir|adicionar|nueva?|new|another|otra?|\+)\b|\b(add|agregar|añadir)\b/i;

  window.__cvfillSeq = window.__cvfillSeq || 0;
  const nextId = () => `f${++window.__cvfillSeq}`;

  const clean = (s, max = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

  function deepAll(selector, root = document, out = []) {
    root.querySelectorAll(selector).forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) deepAll(selector, el.shadowRoot, out); });
    return out;
  }

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function textOf(el) {
    return clean(el?.innerText || el?.textContent || '');
  }

  function byIdInRoot(el, id) {
    const root = el.getRootNode();
    return (root.getElementById && root.getElementById(id)) || document.getElementById(id);
  }

  function nearbyText(el) {
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 150 && !sib.matches(CONTROL_SEL) && !sib.querySelector(CONTROL_SEL)) return t;
        if (sib.querySelector?.(CONTROL_SEL)) break;
        sib = sib.previousElementSibling;
      }
      const parent = node.parentElement;
      if (parent && parent.querySelectorAll(CONTROL_SEL).length === 1) {
        const t = textOf(parent);
        if (t && t.length < 150) return t;
      }
      node = parent;
    }
    return '';
  }

  function labelOf(el) {
    const parts = [];
    if (el.labels && el.labels.length) parts.push([...el.labels].map(textOf).join(' '));
    const lb = el.getAttribute('aria-labelledby');
    if (lb) parts.push(lb.split(/\s+/).map((id) => textOf(byIdInRoot(el, id))).join(' '));
    if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
    const label = clean(parts.filter(Boolean).join(' '));
    return label || clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || nearbyText(el);
  }

  function groupLabelOf(el) {
    const group = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (group) {
      const legend = group.querySelector('legend');
      if (legend) return textOf(legend);
      const lb = group.getAttribute('aria-labelledby');
      if (lb) return clean(lb.split(/\s+/).map((id) => textOf(byIdInRoot(el, id))).join(' '));
      if (group.getAttribute('aria-label')) return clean(group.getAttribute('aria-label'));
    }
    let node = el.parentElement;
    for (let i = 0; i < 5 && node; i++) {
      const radios = node.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`);
      if (radios.length > 1) return nearbyText(node);
      node = node.parentElement;
    }
    return nearbyText(el);
  }

  function sectionOf(el) {
    const fs = el.closest('fieldset');
    const legend = fs?.querySelector('legend');
    if (legend) return textOf(legend);
    let node = el.parentElement;
    for (let i = 0; i < 8 && node; i++) {
      const heads = [...node.querySelectorAll(HEADING_SEL)].filter(
        (h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (heads.length) return textOf(heads[heads.length - 1]).slice(0, 100);
      node = node.parentElement;
    }
    return '';
  }

  function signature(el) {
    return `${el.tagName}|${typeof el.className === 'string' ? el.className : ''}`;
  }

  // Repeated sibling containers (e.g. one div per experience) give the block index
  function blockOf(el) {
    const isBlock = (n) => n.querySelectorAll(CONTROL_SEL).length >= 2;
    let node = el.parentElement;
    for (let i = 0; i < 8 && node && node.parentElement; i++) {
      if (!isBlock(node)) { node = node.parentElement; continue; }
      const sig = signature(node);
      const sibs = [...node.parentElement.children].filter((c) => signature(c) === sig && isBlock(c));
      if (sibs.length >= 2) return sibs.indexOf(node);
      node = node.parentElement;
    }
    return null;
  }

  function kindOf(text) {
    if (EXP_RE.test(text)) return 'experience';
    if (EDU_RE.test(text)) return 'education';
    return null;
  }

  function assignId(el) {
    if (!el.dataset.cvfillId) el.dataset.cvfillId = nextId();
    return el.dataset.cvfillId;
  }

  const controls = deepAll(CONTROL_SEL);
  const fields = [];
  const radioGroups = new Map();
  const counts = { experience: 0, education: 0 };

  for (const el of controls) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;
    if (tag === 'input' && SKIP_TYPES.has(type)) continue;
    if (el.disabled || el.readOnly && type !== 'radio' && type !== 'checkbox' && el.getAttribute('role') !== 'combobox') continue;

    const role = el.getAttribute('role');
    // Skip wrapper comboboxes/textboxes that contain a real control
    if ((role === 'combobox' || role === 'textbox') && !['input', 'select', 'textarea'].includes(tag)) {
      if (el.querySelector('input, select, textarea')) continue;
    }
    if (el.isContentEditable && el.parentElement?.isContentEditable) continue;

    if (type === 'radio') {
      const key = `${el.form ? 'form' : 'doc'}:${el.name || assignId(el)}`;
      let g = radioGroups.get(key);
      if (!g) {
        const id = assignId(el);
        g = {
          id, type: 'radio', label: groupLabelOf(el), name: el.name || '', options: [], required: false,
          visible: false, section: sectionOf(el), block: blockOf(el), value: ''
        };
        radioGroups.set(key, g);
        fields.push(g);
      }
      el.dataset.cvfillGroup = g.id;
      g.options.push(clean(el.labels?.[0] ? textOf(el.labels[0]) : el.value, 100) || el.value);
      g.required = g.required || el.required;
      g.visible = g.visible || isVisible(el) || isVisible(el.labels?.[0]);
      if (el.checked) g.value = g.options[g.options.length - 1];
      continue;
    }

    const id = assignId(el);
    let kind = type;
    if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') kind = 'contenteditable';
    if (role === 'combobox' || (tag === 'input' && (el.getAttribute('aria-autocomplete') || el.getAttribute('list')))) {
      kind = tag === 'input' ? 'combobox' : 'combobox-button';
    }

    const field = {
      id,
      type: kind,
      label: labelOf(el),
      name: clean(el.getAttribute('name'), 80),
      autocomplete: el.getAttribute('autocomplete') || '',
      placeholder: clean(el.getAttribute('placeholder'), 80),
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      visible: type === 'checkbox' ? isVisible(el) || isVisible(el.labels?.[0]) : isVisible(el),
      section: sectionOf(el),
      block: blockOf(el)
    };

    if (tag === 'select') {
      field.options = [...el.options].filter((o) => !o.disabled).map((o) => clean(o.text, 100) || o.value).slice(0, 250);
      field.value = el.selectedIndex > 0 ? clean(el.options[el.selectedIndex]?.text, 100) : '';
    } else if (type === 'checkbox') {
      field.value = el.checked ? 'true' : 'false';
    } else if (tag === 'input' && el.list) {
      field.options = [...el.list.options].map((o) => clean(o.value || o.text, 100)).slice(0, 250);
      field.value = clean(el.value, 200);
    } else if (kind === 'contenteditable' || kind === 'combobox-button') {
      field.value = textOf(el).slice(0, 200);
    } else {
      field.value = clean(el.value, 200);
    }
    if (tag === 'select' && el.multiple) field.multiple = true;
    fields.push(field);
  }

  for (const f of fields) {
    if (!f.visible) continue;
    const text = `${f.label} ${f.name}`;
    if (COMPANY_RE.test(text) && !INSTITUTION_RE.test(text)) counts.experience++;
    else if (INSTITUTION_RE.test(text)) counts.education++;
  }

  const addButtons = [];
  for (const b of deepAll('button, a, [role="button"], input[type="button"]')) {
    if (!isVisible(b)) continue;
    const t = clean(b.innerText || b.value || b.getAttribute('aria-label') || '', 80);
    if (!t || t.length > 60 || !ADD_RE.test(t)) continue;
    const kind = kindOf(t) || kindOf(sectionOf(b));
    if (!kind) continue;
    if (!b.dataset.cvfillBtn) b.dataset.cvfillBtn = `b${++window.__cvfillSeq}`;
    addButtons.push({ id: b.dataset.cvfillBtn, text: t, kind });
  }

  return { url: location.href, fields, counts, addButtons };
}
