// All exported functions are self-contained: injected via executeScript({ func }), cannot reference outer scope

export async function fillFields(items, unfilledIds) {
  const COLORS = { ok: '#1f883d', low: '#d4a72c', bad: '#cf222e' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

  function deepAll(selector, root = document, out = []) {
    root.querySelectorAll(selector).forEach((el) => out.push(el));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) deepAll(selector, el.shadowRoot, out); });
    return out;
  }
  const byId = (id) => deepAll(`[data-cvfill-id="${CSS.escape(id)}"]`)[0];

  function highlight(el, color) {
    if (!el) return;
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = '1px';
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  }

  // Native setter bypasses React/Vue value tracking so frameworks see the change
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    fire(el, 'input');
    fire(el, 'change');
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
    fire(el, 'focusout');
  }

  function bestMatch(candidates, value, getText) {
    const v = norm(value);
    if (!v) return null;
    return candidates.find((c) => norm(getText(c)) === v)
      || candidates.find((c) => norm(c.value) === v)
      || candidates.find((c) => norm(getText(c)).startsWith(v))
      || candidates.find((c) => v.length > 2 && norm(getText(c)).includes(v))
      || candidates.find((c) => norm(getText(c)).length > 2 && v.includes(norm(getText(c))));
  }

  function toDate(v) {
    const m = String(v).match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
    if (!m) return v;
    return `${m[1]}-${m[2].padStart(2, '0')}-${(m[3] || '01').padStart(2, '0')}`;
  }

  function toMonth(v) {
    const m = String(v).match(/(\d{4})-(\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : v;
  }

  function mouseClick(el) {
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    el.click();
  }

  async function pickOption(trigger, value) {
    for (let i = 0; i < 6; i++) {
      await sleep(250);
      let opts = [];
      const ctrl = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns');
      if (ctrl) {
        const lb = (trigger.getRootNode().getElementById?.(ctrl)) || document.getElementById(ctrl);
        if (lb) opts = [...lb.querySelectorAll('[role="option"]')];
      }
      if (!opts.length) opts = deepAll('[role="option"]');
      opts = opts.filter((o) => o.getClientRects().length && o.getAttribute('aria-disabled') !== 'true');
      const match = bestMatch(opts, value, (o) => o.innerText || o.textContent);
      if (match) {
        match.scrollIntoView({ block: 'nearest' });
        mouseClick(match);
        return true;
      }
    }
    return false;
  }

  async function fillCombobox(el, value) {
    el.scrollIntoView({ block: 'center' });
    mouseClick(el);
    el.focus();
    if (el instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      fire(el, 'input');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    }
    const picked = await pickOption(el, value);
    if (!picked && el instanceof HTMLInputElement) {
      // Plain autocomplete/datalist inputs accept the typed text
      fire(el, 'change');
      return el.list ? 'ok' : 'low';
    }
    return picked ? 'ok' : 'fail';
  }

  async function fillOne(item) {
    const value = String(item.value ?? '');

    const radios = deepAll(`[data-cvfill-group="${CSS.escape(item.id)}"]`);
    if (radios.length) {
      const match = bestMatch(radios, value, (r) => r.labels?.[0]?.innerText || r.value);
      if (!match) return { status: 'fail', error: 'Opción no encontrada', el: radios[0] };
      if (!match.checked) mouseClick(match);
      return { status: 'ok', el: match.labels?.[0] || match };
    }

    const el = byId(item.id);
    if (!el) return { status: 'fail', error: 'Campo no encontrado' };
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const role = el.getAttribute('role');

    if (tag === 'select') {
      const opt = bestMatch([...el.options], value, (o) => o.text);
      if (!opt) return { status: 'fail', error: 'Opción no encontrada', el };
      setNativeValue(el, opt.value);
      return { status: 'ok', el };
    }

    if (type === 'checkbox') {
      const want = /^(true|yes|s[ií]|1|on|checked)$/i.test(value.trim());
      if (el.checked !== want) mouseClick(el);
      return { status: 'ok', el: isShown(el) ? el : el.labels?.[0] || el };
    }

    if (type === 'file') return { status: 'fail', error: 'Subida de archivos no soportada', el };

    if (role === 'combobox' || (tag === 'input' && (el.getAttribute('aria-autocomplete') || el.list))) {
      const status = await fillCombobox(el, value);
      return { status, el, error: status === 'fail' ? 'Opción no encontrada en el desplegable' : undefined };
    }

    if (el.isContentEditable && tag !== 'input' && tag !== 'textarea') {
      el.focus();
      document.execCommand('selectAll', false);
      if (!document.execCommand('insertText', false, value)) el.textContent = value;
      fire(el, 'input');
      fire(el, 'change');
      return { status: 'ok', el };
    }

    if (type === 'date') setNativeValue(el, toDate(value));
    else if (type === 'month') setNativeValue(el, toMonth(value));
    else setNativeValue(el, value);
    return { status: 'ok', el };
  }

  function isShown(el) {
    return !!el.getClientRects().length && getComputedStyle(el).opacity !== '0';
  }

  const results = [];
  for (const item of items) {
    try {
      const r = await fillOne(item);
      const low = item.confidence != null && item.confidence < 0.6;
      const status = r.status === 'ok' && low ? 'low' : r.status;
      highlight(r.el, status === 'ok' ? COLORS.ok : status === 'low' ? COLORS.low : COLORS.bad);
      results.push({ id: item.id, status, error: r.error });
      await sleep(30);
    } catch (e) {
      results.push({ id: item.id, status: 'fail', error: String(e?.message || e) });
    }
  }

  for (const id of unfilledIds || []) {
    const radios = deepAll(`[data-cvfill-group="${CSS.escape(id)}"]`);
    const el = radios[0]?.labels?.[0] || radios[0] || byId(id);
    highlight(el, COLORS.bad);
  }

  return results;
}

export function clickAdd(btnId) {
  const find = (root) => {
    const hit = root.querySelector(`[data-cvfill-btn="${CSS.escape(btnId)}"]`);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const r = find(el.shadowRoot);
        if (r) return r;
      }
    }
    return null;
  };
  const btn = find(document);
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return true;
}

export function focusField(id) {
  const find = (root, sel) => {
    const hit = root.querySelector(sel);
    if (hit) return hit;
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        const r = find(el.shadowRoot, sel);
        if (r) return r;
      }
    }
    return null;
  };
  const esc = CSS.escape(id);
  const el = find(document, `[data-cvfill-id="${esc}"]`) || find(document, `[data-cvfill-group="${esc}"]`);
  if (!el) return false;
  const target = el.getClientRects().length ? el : el.labels?.[0] || el;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  const prev = target.style.boxShadow;
  target.style.boxShadow = '0 0 0 4px rgba(9, 105, 218, .5)';
  setTimeout(() => { target.style.boxShadow = prev; }, 1500);
  return true;
}
