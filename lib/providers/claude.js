const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export async function callClaude({ apiKey, model, system, text, pdfBase64, imageBase64, maxTokens = 8192 }) {
  const content = [];
  if (pdfBase64) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  }
  if (imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } });
  }
  content.push({ type: 'text', text });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status}: ${data?.error?.message || res.statusText}`);
  if (data.stop_reason === 'max_tokens') throw new Error('Claude: respuesta truncada (max_tokens)');
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}
