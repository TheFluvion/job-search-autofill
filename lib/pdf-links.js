const URI_RE = /\/URI\s*(\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>)/g;
const VALID_RE = /^(https?:\/\/|mailto:|tel:)/i;

function unescapeLiteral(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, c) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
    if (c === '\n' || c === '\r\n') return '';
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[c] ?? c;
  });
}

function decodeHex(h) {
  const hex = h.replace(/\s/g, '');
  let out = '';
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2).padEnd(2, '0'), 16));
  return out;
}

function collect(text, found) {
  for (const [, raw] of text.matchAll(URI_RE)) {
    const url = (raw.startsWith('(') ? unescapeLiteral(raw.slice(1, -1)) : decodeHex(raw.slice(1, -1))).trim();
    if (VALID_RE.test(url)) found.add(url);
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Link annotations are not part of the visible text the AI reads, so pull their URIs from the raw PDF
export async function extractPdfLinks(buffer) {
  const bytes = new Uint8Array(buffer);
  const latin1 = new TextDecoder('latin1');
  const text = latin1.decode(bytes);
  const found = new Set();
  collect(text, found);

  // Annotations can live inside compressed object streams (PDF 1.5+)
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const objIdx = text.lastIndexOf(' obj', m.index);
    if (objIdx < 0) continue;
    const dict = text.slice(objIdx, m.index);
    if (!dict.includes('/ObjStm') || !dict.includes('/FlateDecode')) continue;
    const len = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let end = len ? start + Number(len[1]) : text.indexOf('endstream', start);
    while (!len && end > start && /[\r\n]/.test(text[end - 1])) end--;
    if (end <= start) continue;
    try {
      collect(latin1.decode(await inflate(bytes.subarray(start, end))), found);
    } catch {}
  }
  return [...found];
}
