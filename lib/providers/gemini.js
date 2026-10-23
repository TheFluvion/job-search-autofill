const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function callGemini({ apiKey, model, system, text, pdfBase64, imageBase64, schema, maxTokens = 16384 }) {
  const parts = [];
  if (pdfBase64) parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  if (imageBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
  parts.push({ text });

  const generationConfig = { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: maxTokens };
  if (schema) generationConfig.responseSchema = schema;

  const url = `${BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message || res.statusText}`);
  const cand = data.candidates?.[0];
  if (!cand) throw new Error(`Gemini: sin respuesta (${data.promptFeedback?.blockReason || 'desconocido'})`);
  if (cand.finishReason === 'MAX_TOKENS') throw new Error('Gemini: respuesta truncada (MAX_TOKENS)');
  return (cand.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
}
