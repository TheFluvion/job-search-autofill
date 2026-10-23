export const PROFILE_TEMPLATE = {
  personal: {
    firstName: null, lastName: null, email: null, phone: null, city: null, state: null, country: null,
    zip: null, address: null, birthDate: null, nationality: null, linkedin: null, github: null, website: null,
    headline: null
  },
  summary: null,
  experience: [{ company: null, title: null, location: null, startDate: null, endDate: null, current: false, description: null }],
  education: [{ institution: null, degree: null, field: null, startDate: null, endDate: null, gpa: null }],
  skills: [],
  languages: [{ name: null, level: null }],
  links: []
};

const STR = { type: 'STRING', nullable: true };
const obj = (props, extra = {}) => ({ type: 'OBJECT', properties: props, ...extra });
const arr = (items) => ({ type: 'ARRAY', items });

export const PROFILE_SCHEMA = obj({
  personal: obj(Object.fromEntries(Object.keys(PROFILE_TEMPLATE.personal).map((k) => [k, STR]))),
  summary: STR,
  experience: arr(obj({
    company: STR, title: STR, location: STR, startDate: STR, endDate: STR,
    current: { type: 'BOOLEAN' }, description: STR
  }, { required: ['company', 'title', 'startDate', 'endDate', 'current', 'description'] })),
  education: arr(obj({ institution: STR, degree: STR, field: STR, startDate: STR, endDate: STR, gpa: STR })),
  skills: arr({ type: 'STRING' }),
  languages: arr(obj({ name: STR, level: STR })),
  links: arr({ type: 'STRING' })
}, { required: ['personal', 'experience', 'education', 'skills', 'languages', 'links'] });

export const MAPPING_SCHEMA = obj({
  mappings: arr(obj({
    fieldId: { type: 'STRING' }, value: { type: 'STRING' }, confidence: { type: 'NUMBER' }, source: STR
  }, { required: ['fieldId', 'value', 'confidence'] })),
  unfilled: arr(obj({
    fieldId: { type: 'STRING' }, label: STR, reason: { type: 'STRING' }
  }, { required: ['fieldId', 'reason'] }))
}, { required: ['mappings', 'unfilled'] });

export const PARSE_SYSTEM = 'You extract structured data from CVs/resumes. Respond with raw JSON only: no markdown, no code fences, no commentary.';

export function buildParsePrompt(links = []) {
  const linksBlock = links.length
    ? `\nHyperlinks embedded in the PDF (may be hidden behind icons or short labels, use them for linkedin/github/website/links):\n${links.map((l) => `- ${l}`).join('\n')}\n`
    : '';
  return `Extract the candidate data from the attached CV into exactly this JSON shape:

${JSON.stringify(PROFILE_TEMPLATE, null, 2)}
${linksBlock}
Rules:
- Never invent data. Use null for unknown scalars and [] for empty lists.
- personal.headline: the professional title under the name (e.g. "Senior Full-Stack Engineer").
- summary: the profile/about/summary paragraph, copied literally.
- experience[].description: REQUIRED whenever the CV lists anything under a job (responsibilities, achievements, projects, technologies). Copy it fully and literally, one bullet per line joined with "\\n". Do not summarize or translate.
- Job headers like "Title — Company", "Title at Company" or "Company | Title": split into title and company.
- Dates: "YYYY-MM" (or "YYYY-MM-DD" only if the day is explicit). Year-only dates: "YYYY". Month names in any language (e.g. "Marzo 2025" -> "2025-03").
- Ongoing jobs ("Presente", "Actualidad", "Present", "Current"): current = true and endDate = null.
- experience and education ordered most recent first.
- education: institution is the school/university name; degree is the title/career; note incomplete studies in degree as written.
- Keep original language of the CV for titles, descriptions and degrees.
- linkedin/github/website as full URLs when present; other URLs go to links.
- phone exactly as written (keep country code).
- city/state/country from the contact location (e.g. "Mendoza, Argentina" -> city "Mendoza", country "Argentina").
- skills: flat list of individual skills/technologies.
- languages.level as written (e.g. "Native", "C1", "B2 (Intermedio Alto)").`;
}

export const MAP_SYSTEM = 'You map job application form fields to a candidate profile. Respond with raw JSON only: no markdown, no code fences, no commentary.';

export function buildMapPrompt(fields, profile) {
  return `Today is ${new Date().toISOString().slice(0, 10)}.

Fill the form fields below using ONLY the candidate PROFILE.

Output shape:
{
  "mappings": [{ "fieldId": "<id>", "value": "<string>", "confidence": 0.0-1.0, "source": "<profile path, e.g. personal.email or experience[0].company>" }],
  "unfilled": [{ "fieldId": "<id>", "label": "<field label>", "reason": "<short reason in Spanish>" }]
}

Rules:
- Every field id must appear exactly once, either in mappings or in unfilled. Use the ids exactly as given.
- Never invent data. If the profile has no data for a field, put it in unfilled (reason e.g. "Sin dato en el CV").
- value is always a string.
- Fields with "options": value MUST be exactly one of the given options. If none fits, unfilled.
- checkbox: value "true" or "false". Only map checkboxes clearly derived from the profile (e.g. "I currently work here"). Consent/terms/marketing checkboxes go to unfilled with reason "Requiere decisión del usuario".
- Dates: type "date" -> "YYYY-MM-DD" (use day 01 if unknown); type "month" -> "YYYY-MM"; text fields follow the format hinted by placeholder/label (MM/YYYY, DD/MM/YYYY, etc.), otherwise "MM/YYYY". Separate month/year fields get only the month or year part, matching the options format.
- Current job: leave its end date fields unfilled (reason "Trabajo actual") and set any "current"/"I currently work here" checkbox to "true".
- Repeatable blocks: fields sharing the same "section" and "block" belong to the same entry. The n-th experience block maps to experience[n] (most recent first), same for education. Without block info, use order of appearance.
- Full name fields -> "firstName lastName". Location fields may combine city/state/country as appropriate.
- Description textareas inside an experience block -> that experience's description.
- "Summary"/"About me"/"Perfil profesional" fields -> summary; "Headline"/"Current title" -> personal.headline.
- The FIELDS list may be just one section of a larger form (the form is filled step by step); map only these fields.
- Open questions (cover letter, salary expectations, motivation, visa/sponsorship, disability, gender, race, veteran status) -> unfilled with reason "Requiere respuesta del usuario" unless the profile clearly answers it.
- Fields that already have a "value" consistent with the profile can still be mapped.
- confidence: 1.0 for exact matches, lower when inferred or reformatted.

FIELDS:
${JSON.stringify(fields)}

PROFILE:
${JSON.stringify(profile)}`;
}
