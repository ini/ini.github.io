// prompt.js — Prompt building for NumThy Gemini (browser-side)
// Fetches API.md from GitHub on page load

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          expr: { type: 'string' },
          explain: { type: 'string' },
        },
        required: ['label', 'expr', 'explain'],
        additionalProperties: false,
      },
    },
    final: { type: 'string' },
  },
  required: ['steps', 'final'],
  additionalProperties: false,
};

const API_MD_URL = 'https://raw.githubusercontent.com/ini/numthy/main/API.md';

// Populated on page load by fetchApiDocs()
let API_DOCS = [];
let CATALOG = [];

/**
 * Parse API.md content into structured docs array.
 * Format: ### name \n ```python\n signature \n``` \n > summary
 */
function parseApiMd(content) {
  const docs = [];
  const catalog = new Set();

  // Split by ### headers (function definitions)
  const sections = content.split(/^### /m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const name = lines[0].trim();
    if (!name || name.includes(' ')) continue; // Skip non-function headers

    catalog.add(name);

    // Find signature in ```python block
    let signature = '';
    const pythonStart = section.indexOf('```python');
    if (pythonStart !== -1) {
      const afterStart = section.slice(pythonStart + 9);
      const pythonEnd = afterStart.indexOf('```');
      if (pythonEnd !== -1) {
        signature = afterStart.slice(0, pythonEnd).trim();
      }
    }

    // Find summary in > blockquote
    let summary = '';
    const summaryMatch = section.match(/^>\s*(.+)/m);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    }

    if (signature) {
      docs.push({ name, signature, summary });
    }
  }

  // Add core types to catalog
  ['Number', 'Vector', 'Matrix', 'Monomial', 'Polynomial', 'clear_cache'].forEach(t => catalog.add(t));

  return { docs, catalog: Array.from(catalog) };
}

/**
 * Fetch and parse API.md from GitHub.
 * Called on page load.
 */
async function fetchApiDocs() {
  try {
    const response = await fetch(API_MD_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    const parsed = parseApiMd(content);
    API_DOCS = parsed.docs;
    CATALOG = parsed.catalog;
    console.log(`Loaded ${API_DOCS.length} API docs, ${CATALOG.length} catalog entries`);
  } catch (err) {
    console.warn('Failed to fetch API.md, using empty docs:', err.message);
    API_DOCS = [];
    CATALOG = [];
  }
}

// Fetch on page load
fetchApiDocs();

// --- Doc snippets ---

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z_]{3,}/g) || []).filter(Boolean);
}

function scoreDoc(doc, tokens) {
  const haystack = `${doc.name} ${doc.signature} ${doc.summary}`.toLowerCase();
  let score = 0;
  tokens.forEach((token) => {
    if (haystack.includes(token)) score += 1;
    if (doc.name.toLowerCase().includes(token)) score += 2;
  });
  return score;
}

function getDocSnippets(query, limit = 8) {
  if (API_DOCS.length === 0) return '- (API docs not loaded)';

  const tokens = tokenize(query);
  const scored = API_DOCS
    .map((doc) => ({ doc, score: scoreDoc(doc, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  let picked = scored.slice(0, limit).map((item) => item.doc);
  if (picked.length === 0) {
    const fallback = new Set(['is_prime', 'primes', 'prime_factors', 'divisors', 'totient', 'crt']);
    picked = API_DOCS.filter((doc) => fallback.has(doc.name)).slice(0, limit);
  }

  return picked
    .map((doc) => {
      const summary = doc.summary ? ` — ${doc.summary}` : '';
      const signature = doc.signature || doc.name;
      const displaySignature = signature.replace(/^([A-Za-z_][\w]*)\s*\(/, 'nt.$1(');
      return `- ${displaySignature}${summary}`;
    })
    .join('\n');
}

// --- Prompt building ---

function buildPlannerPrompt(userPrompt) {
  const docSnippets = getDocSnippets(userPrompt);
  const catalogLine = CATALOG.length > 0
    ? `Allowed NumThy names: ${CATALOG.join(', ')}`
    : 'Allowed NumThy names: (catalog not loaded)';
  const builtinsLine = '- Builtins: all Python builtins are available.';

  return [
    'You are a NumThy planner. Convert the user request into a multi-step plan that uses ONLY NumThy.',
    'Rules:',
    builtinsLine,
    '- No numpy, no sympy, no external imports.',
    '- The session starts with: import numthy as nt (already done). Use nt.<function> for clarity.',
    '- You may define variables and reuse them in later steps.',
    '- Each step must be a SINGLE Python statement or expression. NEVER use semicolons to combine multiple statements.',
    '- Prefer small, tutorial-like steps and explain each step.',
    '- If a function returns an Iterator, wrap it in list(...) for display.',
    '- IMPORTANT: The FINAL STEP in the steps array must have an expr that is an EXPRESSION (not an assignment) to display the answer. If you compute `result = ...` in one step, add another step whose expr is just `result`. Every expression must be a step.',
    '- The "final" field is for an optional prose summary (e.g., "The answer is 42"). Leave it empty ("") if not needed. Do NOT put code or variable names in "final".',
    '- Return JSON that matches the provided schema exactly.',
    catalogLine,
    'Relevant NumThy API:',
    docSnippets || '- (no relevant snippets found)',
    '',
    `User request: ${userPrompt}`,
  ].join('\n');
}

function buildGeminiPrompt(userPrompt) {
  const base = buildPlannerPrompt(userPrompt);
  const schema = JSON.stringify(PLAN_SCHEMA);
  return `${base}

IMPORTANT: You MUST respond with ONLY valid JSON matching this exact schema:
${schema}

Rules for your response:
- Output ONLY the JSON object, nothing else
- Do NOT include any text before or after the JSON
- Do NOT wrap the JSON in markdown code blocks
- The response must be directly parseable by JSON.parse()`;
}

// --- Plan normalization ---

function normalizePlan(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    throw new Error('Planner returned invalid JSON (missing steps).');
  }
  const steps = plan.steps
    .filter((step) => step && typeof step.expr === 'string')
    .map((step, index) => ({
      label: step.label || `Step ${index + 1}`,
      expr: step.expr.trim(),
      explain: step.explain || '',
    }))
    .filter((step) => step.expr.length > 0);

  if (steps.length === 0) {
    throw new Error('Planner did not provide any executable steps.');
  }

  return {
    steps,
    final: typeof plan.final === 'string' ? plan.final : '',
  };
}

// --- JSON extraction ---

function extractJSON(output) {
  const trimmed = output.trim();

  try {
    const direct = JSON.parse(trimmed);
    if (direct.result && typeof direct.result === 'string') return extractJSON(direct.result);
    if (direct.content && typeof direct.content === 'string') return extractJSON(direct.content);
    if (direct.response && typeof direct.response === 'string') return extractJSON(direct.response);
    return direct;
  } catch (e) {
    // Continue to fallback extraction
  }

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch (e) { /* continue */ }
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) { /* continue */ }
  }

  throw new Error(`Could not extract valid JSON from Gemini response. Raw output: ${trimmed.slice(0, 500)}`);
}
