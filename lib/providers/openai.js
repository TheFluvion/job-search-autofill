const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

export async function callOpenAI({ apiKey, model, system, text, pdfBase64, imageBase64, maxTokens = 16384 }) {
  const content = [];
  if (pdfBase64) {
    content.push({
      type: 'file',
      file: { filename: 'cv.pdf', file_data: `data:application/pdf;base64,${pdfBase64}` }
    });
  }
  if (imageBase64) {
    content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } });
  }
  content.push({ type: 'text', text });

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data?.error?.message || res.statusText}`);
  if (data.choices?.[0]?.finish_reason === 'length') throw new Error('OpenAI: respuesta truncada (max_tokens)');
  return data.choices?.[0]?.message?.content || '';
}
