const homeEl = document.getElementById('home');
const resultsViewEl = document.getElementById('resultsView');
const resultsEl = document.getElementById('results');
const statusEl = document.getElementById('status');
const promptEl = document.getElementById('prompt');
const promptMiniEl = document.getElementById('promptMini');
const modelPickerEl = document.getElementById('modelPicker');
const modelPickerBtn = document.getElementById('modelPickerBtn');
const modelPickerLabel = document.getElementById('modelPickerLabel');
const modelPickerDropdown = document.getElementById('modelPickerDropdown');
const modelPickerMenu = document.getElementById('modelPickerMenu');
const modelPickerMore = document.getElementById('modelPickerMore');
const bridgeUrlEl = document.getElementById('bridgeUrl');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsClose = document.getElementById('settingsClose');
const logoSmall = document.querySelector('.logo-small');
const submitBtn = document.getElementById('submitBtn');
const submitBtnMini = document.getElementById('submitBtnMini');
const spinnerEl = document.getElementById('spinner');
const bridgeOverlay = document.getElementById('bridgeOverlay');
const bridgeUrlOverlay = document.getElementById('bridgeUrlOverlay');
const bridgeRetry = document.getElementById('bridgeRetry');
const bridgeCancel = document.getElementById('bridgeCancel');
const replLink = document.getElementById('replLink');

// Gemini auth overlay elements
const geminiAuthOverlay = document.getElementById('geminiAuthOverlay');
const geminiAuthLink = document.getElementById('geminiAuthLink');
const geminiAuthCode = document.getElementById('geminiAuthCode');
const geminiAuthSubmit = document.getElementById('geminiAuthSubmit');
const geminiAuthError = document.getElementById('geminiAuthError');
const geminiAuthCancel = document.getElementById('geminiAuthCancel');

// Pending Gemini query (stored while auth is in progress)
let pendingGeminiQuery = null;

// Pending bridge query (stored while waiting for bridge connection)
let pendingBridgeQuery = null;

// Safari detection - Safari blocks mixed content (HTTP from HTTPS page)
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let currentSource = null;
let bridgeBackends = [];
let bridgeConnected = false;
let unifiedModels = [];
let selectedModelValue = null;
let sessionStartShown = false;
let autoRetryInterval = null;
let blockQueue = [];
let lastBlockTime = 0;
let blockTimer = null;
let typewriterTimer = null;
let typewriterActive = false;

const EXAMPLE_QUESTIONS = [
  'Is 2^127 - 1 prime?',
  'Generate a random 150-bit semiprime, then factor it',
  'Solve 7^x = 5 mod 13',
  'Get the first ten Fibonacci numbers',
  'Find all primes between 100 and 150',
  'Solve the system 2x + 4y = -2 and 4x + 5y = 11',
  'Divisors of 360',
  'What is the totient of 123456789?'
];

const STORAGE_KEYS = {
  bridgeUrl: 'numthy.bridgeUrl',
  bridgeHttpsUrl: 'numthy.bridgeHttpsUrl',
  selectedModel: 'numthy.selectedModel',
};

// Static model lists for Claude and Codex (shown when bridge is offline)
// Values must match what the bridge returns
const CLAUDE_MODELS = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

const CODEX_MODELS = [
  { value: 'gpt-5.2-codex', label: 'GPT 5.2 Codex' },
  { value: 'gpt-5.2', label: 'GPT 5.2' },
  { value: 'gpt-5.1-codex-max', label: 'GPT 5.1 Codex Max' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT 5.1 Codex Mini' },
];

// Format Codex model slug to nice label (e.g., "gpt-5.1-codex-mini" -> "GPT 5.1 Codex Mini")
function formatCodexLabel(slug) {
  return slug
    .replace(/^gpt-/, 'GPT ')
    .replace(/-codex/, ' Codex')
    .replace(/-max$/, ' Max')
    .replace(/-mini$/, ' Mini')
    .replace(/-/g, '.');
}

// Get HTTPS URL from HTTP URL (for Safari fallback)
function getHttpsUrl(httpUrl) {
  try {
    const url = new URL(httpUrl);
    const savedHttps = localStorage.getItem(STORAGE_KEYS.bridgeHttpsUrl);
    if (savedHttps) {
      const savedUrl = new URL(savedHttps);
      // Only use saved HTTPS if it's for the same host
      if (savedUrl.hostname === url.hostname) {
        return savedHttps;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = 'status-indicator';
  if (type) statusEl.classList.add(type);
  // Show/hide spinner
  if (type === 'running') {
    spinnerEl.classList.remove('hidden');
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 50);
  } else {
    spinnerEl.classList.add('hidden');
  }
  updateMiniSearchMargin();
}

function showHome() {
  homeEl.style.display = '';
  resultsViewEl.classList.add('hidden');
  resultsViewEl.style.display = 'none';
  statusEl.style.display = 'none';
  replLink.style.display = '';
  promptEl.value = promptMiniEl.value;
  promptEl.focus();
}

function showResults() {
  homeEl.style.display = 'none';
  resultsViewEl.classList.remove('hidden');
  resultsViewEl.style.display = '';
  statusEl.style.display = '';
  replLink.style.display = 'none';
  resultsEl.innerHTML = '';
  blockQueue = [];
  if (blockTimer) {
    clearTimeout(blockTimer);
    blockTimer = null;
  }
  lastBlockTime = 0;
  updateMiniSearchMargin();
}

function blockShell(title) {
  const block = document.createElement('div');
  block.className = 'block';
  const heading = document.createElement('h3');
  heading.textContent = title;
  block.appendChild(heading);
  return block;
}

function renderBlock(block) {
  if (!block || !block.type) return null;

  if (block.type === 'step') {
    const shell = document.createElement('div');
    shell.className = 'block step';
    const heading = document.createElement('h3');
    heading.textContent = block.title || 'Step';
    shell.appendChild(heading);

    if (block.explain) {
      const explain = document.createElement('p');
      explain.className = 'explain';
      explain.textContent = block.explain;
      shell.appendChild(explain);
    }

    if (block.expr) {
      const expr = document.createElement('pre');
      expr.className = 'expr';
      const code = document.createElement('code');
      code.className = 'language-python';
      code.textContent = block.expr;
      expr.appendChild(code);
      shell.appendChild(expr);
      if (window.Prism) {
        Prism.highlightElement(code);
      }
    }

    if (block.error) {
      const error = document.createElement('p');
      error.className = 'error';
      error.textContent = block.error;
      shell.appendChild(error);
      return shell;
    }

    if (Array.isArray(block.result) && block.result.length) {
      const results = document.createElement('div');
      results.className = 'step-results';
      block.result.forEach((child) => {
        const node = renderBlock(child);
        if (node) results.appendChild(node);
      });
      shell.appendChild(results);
    }
    return shell;
  }

  if (block.type === 'error') {
    const shell = blockShell('Error');
    shell.classList.add('error-block');
    const p = document.createElement('p');
    p.className = 'error';
    p.textContent = block.content;
    shell.appendChild(p);
    return shell;
  }

  if (block.type === 'text') {
    const shell = blockShell('Output');
    const p = document.createElement('p');
    p.textContent = block.content;
    shell.appendChild(p);
    return shell;
  }

  if (block.type === 'latex') {
    const shell = blockShell('Math');
    const latex = document.createElement('div');
    latex.className = 'latex';
    if (window.katex) {
      window.katex.render(block.content, latex, { throwOnError: false });
    } else {
      latex.textContent = block.content;
    }
    shell.appendChild(latex);
    return shell;
  }

  if (block.type === 'table') {
    const shell = blockShell('Table');
    const table = document.createElement('table');
    table.className = 'table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    (block.content?.headers || []).forEach((header) => {
      const th = document.createElement('th');
      th.textContent = header;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    (block.content?.rows || []).forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    shell.appendChild(table);
    return shell;
  }

  const shell = blockShell(block.type);
  const fallback = document.createElement('p');
  fallback.textContent = JSON.stringify(block, null, 2);
  shell.appendChild(fallback);
  return shell;
}

function showBlock(block) {
  const node = renderBlock(block);
  if (node) {
    resultsEl.appendChild(node);
    // Scroll to show spinner (which is after all blocks)
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 50);
  }
  lastBlockTime = Date.now();
}

function processBlockQueue() {
  if (blockQueue.length === 0) {
    blockTimer = null;
    return;
  }
  const block = blockQueue.shift();
  showBlock(block);
  blockTimer = setTimeout(processBlockQueue, 500);
}

function appendBlock(block) {
  blockQueue.push(block);
  const now = Date.now();
  const timeSinceLast = now - lastBlockTime;

  if (!blockTimer) {
    if (timeSinceLast >= 500) {
      processBlockQueue();
    } else {
      blockTimer = setTimeout(processBlockQueue, 500 - timeSinceLast);
    }
  }
}

function closeStream() {
  if (currentSource) {
    currentSource.close();
    currentSource = null;
  }
}

function getSelectedModel() {
  if (selectedModelValue) {
    const m = unifiedModels.find((x) => `${x.backend}:${x.model}` === selectedModelValue);
    if (m) return m;
  }
  // Fallback to first available model
  if (unifiedModels.length > 0) {
    return unifiedModels[0];
  }
  return { backend: 'gemini', model: GEMINI_DEFAULT_MODEL };
}

function buildUnifiedModelList() {
  unifiedModels = [];

  // Always include Gemini models (browser-side, no bridge needed)
  GEMINI_MODELS.forEach((model) => {
    unifiedModels.push({
      backend: 'gemini',
      backendDisplayName: 'Gemini',
      model: model.value,
      label: model.label,
      available: true,
      isDefault: model.isDefault,
    });
  });

  // Find bridge backends
  const bridgeClaude = bridgeBackends.find(b => b.name === 'claude');
  const bridgeCodex = bridgeBackends.find(b => b.name === 'codex');

  // Claude: show bridge models if connected, otherwise static models (unavailable)
  if (bridgeConnected && bridgeClaude?.models?.length) {
    bridgeClaude.models.forEach((model) => {
      unifiedModels.push({
        backend: 'claude',
        backendDisplayName: bridgeClaude.displayName || 'Claude',
        model: model.value,
        label: model.label.replace(/^Claude\s+/, ''),
        available: true,
      });
    });
  } else {
    // Show static Claude models as unavailable
    CLAUDE_MODELS.forEach((model) => {
      unifiedModels.push({
        backend: 'claude',
        backendDisplayName: 'Claude',
        model: model.value,
        label: model.label,
        available: false,
      });
    });
  }

  // Codex: show bridge models if connected, otherwise static models (unavailable)
  if (bridgeConnected && bridgeCodex?.models?.length) {
    bridgeCodex.models.forEach((model) => {
      unifiedModels.push({
        backend: 'codex',
        backendDisplayName: bridgeCodex.displayName || 'Codex',
        model: model.value,
        label: formatCodexLabel(model.value),
        available: true,
      });
    });
  } else {
    // Show static Codex models as unavailable
    CODEX_MODELS.forEach((model) => {
      unifiedModels.push({
        backend: 'codex',
        backendDisplayName: 'Codex',
        model: model.value,
        label: model.label,
        available: false,
      });
    });
  }

  // Add any other backends from bridge
  bridgeBackends.forEach((backend) => {
    if (backend.name === 'gemini' || backend.name === 'claude' || backend.name === 'codex') return;
    (backend.models || []).forEach((model) => {
      unifiedModels.push({
        backend: backend.name,
        backendDisplayName: backend.displayName || backend.name,
        model: model.value,
        label: model.label,
        available: true,
      });
    });
  });
}

function selectModel(value, isManualSelection = false) {
  const model = unifiedModels.find((m) => `${m.backend}:${m.model}` === value);

  // If model not found, fall back to default or first available
  if (!model && unifiedModels.length > 0) {
    const fallback = unifiedModels.find(m => m.available && m.isDefault) ||
                     unifiedModels.find(m => m.available) ||
                     unifiedModels[0];
    value = `${fallback.backend}:${fallback.model}`;
  }

  const actualModel = unifiedModels.find((m) => `${m.backend}:${m.model}` === value);

  // On manual selection, trigger auth/bridge overlay if needed
  if (isManualSelection && actualModel) {
    if (actualModel.backend === 'gemini' && !checkGeminiAuth()) {
      // Gemini needs auth
      showGeminiAuthOverlay();
    } else if (!actualModel.available) {
      // Claude/Codex need bridge
      bridgeOverlay.classList.remove('hidden');
      startAutoRetry();
    }
    // Still update the selection so user sees what they picked
  }

  selectedModelValue = value;
  localStorage.setItem(STORAGE_KEYS.selectedModel, value);

  modelPickerLabel.textContent = actualModel ? actualModel.label : 'Select model';

  // Update picker button styling for unavailable models
  modelPickerBtn.classList.toggle('unavailable', actualModel && !actualModel.available);

  // Update selected state in menu
  modelPickerMenu.querySelectorAll('.model-picker-option').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.value === value);
  });

  closeModelPicker();
  updateMiniSearchMargin();
}

function renderModelPicker() {
  modelPickerMenu.innerHTML = '';

  const grouped = {};
  unifiedModels.forEach((m) => {
    if (!grouped[m.backendDisplayName]) {
      grouped[m.backendDisplayName] = [];
    }
    grouped[m.backendDisplayName].push(m);
  });

  // Preferred order: Claude, GPT/Codex, Gemini, then others
  const order = ['Claude', 'Claude Code', 'Codex', 'GPT Codex', 'Gemini'];
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  sortedGroups.forEach(([backendName, models]) => {
    const groupLabel = document.createElement('div');
    groupLabel.className = 'model-picker-group';
    groupLabel.textContent = backendName;
    modelPickerMenu.appendChild(groupLabel);

    models.forEach((m) => {
      const btn = document.createElement('button');
      btn.className = 'model-picker-option';
      btn.type = 'button';
      btn.textContent = m.label;
      btn.dataset.value = `${m.backend}:${m.model}`;
      if (btn.dataset.value === selectedModelValue) {
        btn.classList.add('selected');
      }
      // Mark unavailable models
      if (!m.available) {
        btn.classList.add('unavailable');
        btn.title = 'Requires bridge (npx numthy)';
      }
      btn.addEventListener('click', () => selectModel(btn.dataset.value, true));
      modelPickerMenu.appendChild(btn);
    });
  });

  // Restore saved selection or select first available (not manual, don't trigger overlays)
  const saved = localStorage.getItem(STORAGE_KEYS.selectedModel);
  if (saved && unifiedModels.some((m) => `${m.backend}:${m.model}` === saved)) {
    selectModel(saved);
  } else if (unifiedModels.length > 0) {
    // Default to model with isDefault flag, or first available (Gemini if bridge offline)
    const firstAvailable = unifiedModels.find(m => m.available && m.isDefault) ||
                           unifiedModels.find(m => m.available) ||
                           unifiedModels[0];
    selectModel(`${firstAvailable.backend}:${firstAvailable.model}`);
  } else {
    // No models available - reset state
    selectedModelValue = null;
    modelPickerLabel.textContent = 'Select model';
  }
}

function updateMoreIndicator() {
  const hasOverflow = modelPickerMenu.scrollHeight > modelPickerMenu.clientHeight;
  const atBottom = modelPickerMenu.scrollTop + modelPickerMenu.clientHeight >= modelPickerMenu.scrollHeight - 5;

  if (hasOverflow && !atBottom) {
    modelPickerMore.classList.remove('hidden');
  } else {
    modelPickerMore.classList.add('hidden');
  }
}

modelPickerMenu.addEventListener('scroll', updateMoreIndicator);

function openModelPicker() {
  modelPickerEl.classList.add('open');
  modelPickerDropdown.classList.remove('hidden');
  setTimeout(() => {
    // Scroll to selected model
    const selected = modelPickerMenu.querySelector('.model-picker-option.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    updateMoreIndicator();
  }, 0);
}

function closeModelPicker() {
  modelPickerEl.classList.remove('open');
  modelPickerDropdown.classList.add('hidden');
}

function toggleModelPicker() {
  if (modelPickerEl.classList.contains('open')) {
    closeModelPicker();
  } else {
    openModelPicker();
  }
}

modelPickerBtn.addEventListener('click', toggleModelPicker);

// Close picker when clicking outside
document.addEventListener('click', (e) => {
  if (!modelPickerEl.contains(e.target)) {
    closeModelPicker();
  }
});

function updateMiniSearchMargin() {
  const pickerWidth = modelPickerEl.offsetWidth;
  const rightOffset = 16; // model picker's right position from viewport
  const gap = 12; // consistent spacing between elements
  const statusWidth = statusEl.offsetWidth;
  const headerPadding = 20; // header has padding-right: 20px
  // Position status indicator to the left of model picker
  statusEl.style.right = `${pickerWidth + rightOffset + gap}px`;
  // Search container margin: account for fixed elements but subtract header padding since textbox is inside header
  const searchContainerMini = promptMiniEl.parentElement;
  searchContainerMini.style.marginRight = `${pickerWidth + rightOffset + gap + statusWidth + gap - headerPadding}px`;

  // Vertically align fixed elements with the textbox center (only on results view)
  const isResultsView = !resultsViewEl.classList.contains('hidden');
  if (isResultsView) {
    const inputRect = promptMiniEl.getBoundingClientRect();
    const inputCenterY = inputRect.top + inputRect.height / 2;
    const pickerHeight = modelPickerEl.offsetHeight;
    const statusHeight = statusEl.offsetHeight;
    modelPickerEl.style.top = `${inputCenterY - pickerHeight / 2}px`;
    statusEl.style.top = `${inputCenterY - statusHeight / 2}px`;
  } else {
    // Reset to default position on home view
    modelPickerEl.style.top = '';
    statusEl.style.top = '';
  }
}

async function runQuery(query) {
  const prompt = query.trim();
  const selected = getSelectedModel();
  if (!prompt) return;

  promptMiniEl.value = prompt;

  // Branch on backend
  if (selected.backend === 'gemini') {
    return runGeminiQuery(prompt, selected.model);
  }
  return runBridgeQuery(prompt, selected);
}

// --- Gemini query: fully client-side (OAuth + Code Assist API + Pyodide) ---

async function runGeminiQuery(prompt, model) {
  showResults();

  try {
    // 1. Check if authenticated
    const isAuthed = checkGeminiAuth();
    if (!isAuthed) {
      // Store pending query and show auth overlay
      pendingGeminiQuery = { prompt, model };
      await showGeminiAuthOverlay();
      return; // Will continue in auth callback
    }

    // 2. Continue with the query
    await executeGeminiQuery(prompt, model);
  } catch (err) {
    blockQueue = [];
    appendBlock({ type: 'error', content: err.message });
    setStatus('Error', 'error');
  }
}

async function showGeminiAuthOverlay() {
  try {
    const authUrl = await startGeminiAuth();
    geminiAuthLink.href = authUrl;
    geminiAuthCode.value = '';
    geminiAuthError.classList.add('hidden');
    geminiAuthOverlay.classList.remove('hidden');
  } catch (err) {
    throw new Error(`Failed to start auth: ${err.message}`);
  }
}

async function executeGeminiQuery(prompt, model) {
  try {
    // 1. Show session start immediately
    appendBlock({
      type: 'step',
      title: 'Session Start',
      explain: 'Import NumThy',
      expr: 'import numthy as nt',
    });

    // 2. Start Pyodide loading and plan generation in parallel
    setStatus('Planning ...', 'running');
    const pyodidePromise = initPyodide((status) => {
      // Only update status if still planning (don't overwrite "Running ...")
      if (statusEl.textContent.includes('Planning') || statusEl.textContent.includes('Loading')) {
        setStatus(status, 'running');
      }
    });
    const planPromise = geminiGeneratePlan(prompt, model);

    // Wait for both plan and Pyodide (in parallel)
    const [plan] = await Promise.all([planPromise, pyodidePromise]);
    pyReset();

    // 3. Execute each step: show command, then execute, then show result
    setStatus('Running ...', 'running');
    // Double RAF to ensure paint before continuing
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    for (const step of plan.steps) {
      // Show the step (command + explanation) immediately
      const stepBlock = {
        type: 'step',
        title: step.label,
        explain: step.explain,
        expr: step.expr,
        result: [],
      };
      const node = renderBlock(stepBlock);
      if (node) {
        resultsEl.appendChild(node);
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        // Double RAF to ensure step is painted before executing
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      // Execute and append result to this node
      const result = await pyExec(step.expr);

      if (!result.ok) {
        const error = document.createElement('p');
        error.className = 'error';
        error.textContent = result.error;
        node.appendChild(error);
      } else if (result.blocks && result.blocks.length > 0) {
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'step-results';
        result.blocks.forEach((block) => {
          const blockNode = renderBlock(block);
          if (blockNode) resultsDiv.appendChild(blockNode);
        });
        node.appendChild(resultsDiv);
      }

      // Scroll to show the result
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }

    // 6. Show final note (skip if it looks like code - no spaces or starts with variable/bracket)
    const finalText = (plan.final || '').trim();
    if (finalText && /\s/.test(finalText) && !/^[\w({[]/.test(finalText)) {
      appendBlock({ type: 'text', content: finalText });
    }

    setStatus('Done', 'done');
  } catch (err) {
    if (err.message === 'AUTH_REQUIRED') {
      // Token expired, need to re-auth
      pendingGeminiQuery = { prompt, model };
      await showGeminiAuthOverlay();
      return;
    }
    throw err;
  }
}

// --- Bridge query: uses local bridge server for Claude/Codex ---

async function runBridgeQuery(prompt, selected) {
  // Check bridge connection first
  if (!bridgeConnected) {
    pendingBridgeQuery = { prompt, selected };
    bridgeOverlay.classList.remove('hidden');
    startAutoRetry();
    return;
  }

  const bridgeUrl = getBridgeUrl();
  localStorage.setItem(STORAGE_KEYS.bridgeUrl, bridgeUrl);

  showResults();
  setStatus('Planning ...', 'running');
  closeStream();

  // Show session start after 1s delay (unless backend responds first)
  let backendResponded = false;
  const sessionStartTimeout = setTimeout(() => {
    if (!backendResponded) {
      sessionStartShown = true;
      appendBlock({
        type: 'step',
        title: 'Session Start',
        explain: 'Import NumThy',
        expr: 'import numthy as nt',
      });
    }
  }, 1000);

  try {
    const response = await fetch(`${bridgeUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model: selected.model,
        backend: selected.backend,
      }),
    });

    if (!response.ok) {
      let message = await response.text();
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.error) {
          message = parsed.error;
        }
      } catch (err) {
        // ignore
      }
      throw new Error(message || `Request failed: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.jobId) {
      throw new Error('Missing job id from server');
    }

    const streamUrl = `${bridgeUrl}/stream/${data.jobId}`;
    const source = new EventSource(streamUrl);
    currentSource = source;

    source.addEventListener('step', (event) => {
      backendResponded = true;
      clearTimeout(sessionStartTimeout);
      setStatus('Running ...', 'running');
      const payload = event.data ? JSON.parse(event.data) : {};
      const block = payload.block || payload;
      // Skip duplicate session start block
      if (sessionStartShown && block.title?.toLowerCase().includes('session start')) {
        sessionStartShown = false; // Only skip once
        return;
      }
      appendBlock(block);
    });

    source.addEventListener('final', (event) => {
      const payload = event.data ? JSON.parse(event.data) : {};
      const block = payload.block || payload;
      appendBlock(block);
    });

    source.addEventListener('fail', (event) => {
      clearTimeout(sessionStartTimeout);
      blockQueue = [];
      const payload = event.data ? JSON.parse(event.data) : {};
      const message = payload.message || 'Failed';
      appendBlock({ type: 'error', content: message });
      setStatus('Error', 'error');
      closeStream();
    });

    source.addEventListener('done', () => {
      setStatus('Done', 'done');
      closeStream();
    });

    source.onerror = () => {
      clearTimeout(sessionStartTimeout);
      blockQueue = [];
      appendBlock({ type: 'error', content: 'Connection error' });
      setStatus('Error', 'error');
      closeStream();
    };
  } catch (err) {
    clearTimeout(sessionStartTimeout);
    blockQueue = [];
    appendBlock({ type: 'error', content: err.message });
    setStatus('Error', 'error');
  }
}

// Home search
promptEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runQuery(promptEl.value);
  }
});

// Submit button
submitBtn.addEventListener('click', () => {
  runQuery(promptEl.value);
});

// Mini search bar
promptMiniEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runQuery(promptMiniEl.value);
  }
});

// Mini submit button
submitBtnMini.addEventListener('click', () => {
  runQuery(promptMiniEl.value);
});

// Click logo to go home
logoSmall.addEventListener('click', showHome);

// Settings panel
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});

settingsClose.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  localStorage.setItem(STORAGE_KEYS.bridgeUrl, bridgeUrlEl.value.trim());
  tryBridgeConnection();
});

settingsPanel.addEventListener('click', (e) => {
  if (e.target === settingsPanel) {
    settingsPanel.classList.add('hidden');
  }
});

// Typewriter effect for placeholder
function startTypewriter() {
  if (typewriterActive) return;
  typewriterActive = true;

  const initialText = 'Ask a math question ...';
  let questionIndex = Math.floor(Math.random() * EXAMPLE_QUESTIONS.length);
  let charIndex = initialText.length;
  let isDeleting = true; // Start by deleting the initial text
  let pauseTime = 2000; // 2s delay before starting
  let currentText = initialText;

  promptEl.placeholder = initialText;

  function getTypeDelay() {
    return 55 + Math.random() * 25; // 55-80ms, slight randomness for natural feel
  }

  function tick() {
    if (!typewriterActive) return;

    if (pauseTime > 0) {
      pauseTime -= 16;
      typewriterTimer = setTimeout(tick, 16);
      return;
    }

    if (isDeleting) {
      charIndex--;
      promptEl.placeholder = currentText.substring(0, charIndex);

      if (charIndex === 0) {
        isDeleting = false;
        currentText = EXAMPLE_QUESTIONS[questionIndex];
        pauseTime = 400;
      }
      // Delete faster, with slight easing
      const deleteDelay = 20 + (charIndex / currentText.length) * 15;
      typewriterTimer = setTimeout(tick, deleteDelay);
    } else {
      charIndex++;
      promptEl.placeholder = currentText.substring(0, charIndex);

      if (charIndex === currentText.length) {
        isDeleting = true;
        pauseTime = 2500;
        questionIndex = (questionIndex + 1) % EXAMPLE_QUESTIONS.length;
      }
      typewriterTimer = setTimeout(tick, getTypeDelay());
    }
  }

  tick();
}

function stopTypewriter() {
  typewriterActive = false;
  if (typewriterTimer) {
    clearTimeout(typewriterTimer);
    typewriterTimer = null;
  }
  promptEl.placeholder = 'Ask a math question ...';
}

// Stop typewriter when user types
promptEl.addEventListener('input', () => {
  if (promptEl.value !== '') {
    stopTypewriter();
  }
});

// Init
window.addEventListener('DOMContentLoaded', () => {
  const savedBridgeUrl = localStorage.getItem(STORAGE_KEYS.bridgeUrl);
  if (savedBridgeUrl) {
    bridgeUrlEl.value = savedBridgeUrl;
    bridgeUrlOverlay.value = savedBridgeUrl;
  }

  // Restore saved HTTPS URL for Safari returning users
  const savedHttpsUrl = localStorage.getItem(STORAGE_KEYS.bridgeHttpsUrl);
  if (savedHttpsUrl) {
    activeBridgeUrl = savedHttpsUrl;
  }

  statusEl.style.display = 'none'; // Hidden on home view

  // Always show Gemini models immediately (no bridge needed)
  buildUnifiedModelList();
  renderModelPicker();

  promptEl.focus();

  // Try bridge silently in background for Claude/Codex
  tryBridgeConnection();

  updateMiniSearchMargin();
  startTypewriter();
});

window.addEventListener('resize', updateMiniSearchMargin);

function startAutoRetry() {
  if (autoRetryInterval) return;
  autoRetryInterval = setInterval(() => {
    refreshBackendInfo();
  }, 2000);
}

function stopAutoRetry() {
  if (autoRetryInterval) {
    clearInterval(autoRetryInterval);
    autoRetryInterval = null;
  }
}

// Track the active bridge URL (may differ from input if using HTTPS)
let activeBridgeUrl = null;

async function tryFetch(url) {
  try {
    const response = await fetch(`${url}/health`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Check if server is reachable (even if CORS blocks the response)
// Uses no-cors mode which succeeds if server responds, fails if server is down
async function isServerReachable(url) {
  try {
    await fetch(`${url}/health`, { mode: 'no-cors' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try connecting to the bridge silently (no overlay).
 * Used on page load and when settings change.
 */
async function tryBridgeConnection() {
  const bridgeUrl = bridgeUrlEl.value.trim().replace(/\/$/, '');
  if (!bridgeUrl) return;

  let data = await tryFetch(bridgeUrl);
  if (data) {
    activeBridgeUrl = bridgeUrl;
    onBridgeConnected(data);
    return;
  }

  const savedHttpsUrl = getHttpsUrl(bridgeUrl);
  if (savedHttpsUrl) {
    data = await tryFetch(savedHttpsUrl);
    if (data) {
      activeBridgeUrl = savedHttpsUrl;
      onBridgeConnected(data);
      return;
    }
  }

  // Not connected — that's fine, Gemini still works
  bridgeConnected = false;
}

/**
 * Legacy refreshBackendInfo — used by overlay retry and settings.
 * Shows overlay if not connected.
 */
async function refreshBackendInfo() {
  const bridgeUrl = bridgeUrlEl.value.trim().replace(/\/$/, '');
  if (!bridgeUrl) {
    bridgeOverlay.classList.remove('hidden');
    startAutoRetry();
    return;
  }

  let data = await tryFetch(bridgeUrl);
  if (data) {
    activeBridgeUrl = bridgeUrl;
    onBridgeConnected(data);
    return;
  }

  const savedHttpsUrl = getHttpsUrl(bridgeUrl);
  if (savedHttpsUrl) {
    data = await tryFetch(savedHttpsUrl);
    if (data) {
      activeBridgeUrl = savedHttpsUrl;
      onBridgeConnected(data);
      return;
    }
  }

  bridgeOverlay.classList.remove('hidden');
  startAutoRetry();
}

function onBridgeConnected(data) {
  bridgeOverlay.classList.add('hidden');
  stopAutoRetry();
  bridgeConnected = true;

  if (data.backends && Array.isArray(data.backends)) {
    bridgeBackends = data.backends;
    // Rebuild model list with bridge backends merged in
    buildUnifiedModelList();
    renderModelPicker();
    updateMiniSearchMargin();
  }

  // Resume pending bridge query if any
  if (pendingBridgeQuery) {
    const { prompt, selected } = pendingBridgeQuery;
    pendingBridgeQuery = null;
    runBridgeQuery(prompt, selected);
  }
}

// Get the currently active bridge URL for API calls
function getBridgeUrl() {
  return activeBridgeUrl || bridgeUrlEl.value.trim().replace(/\/$/, '');
}

bridgeUrlEl.addEventListener('change', () => {
  const url = bridgeUrlEl.value.trim();
  bridgeUrlOverlay.value = url;
  localStorage.setItem(STORAGE_KEYS.bridgeUrl, url);
  // Clear saved HTTPS when user changes URL
  localStorage.removeItem(STORAGE_KEYS.bridgeHttpsUrl);
  activeBridgeUrl = null;
  bridgeConnected = false;
  tryBridgeConnection();
});

bridgeRetry.addEventListener('click', async () => {
  const url = bridgeUrlOverlay.value.trim().replace(/\/$/, '');
  bridgeUrlEl.value = url;
  localStorage.setItem(STORAGE_KEYS.bridgeUrl, url);

  // If URL is already HTTPS, use it directly
  if (url.startsWith('https://')) {
    localStorage.setItem(STORAGE_KEYS.bridgeHttpsUrl, url);
    activeBridgeUrl = url;
  } else {
    // Clear saved HTTPS when user changes to HTTP URL
    localStorage.removeItem(STORAGE_KEYS.bridgeHttpsUrl);
    activeBridgeUrl = null;
  }

  bridgeRetry.disabled = true;
  bridgeRetry.textContent = 'Connecting ...';

  // Try to connect (show "Connecting ..." for at least 1s)
  const start = Date.now();
  const data = await tryFetch(url);
  if (data) {
    activeBridgeUrl = url;
    onBridgeConnected(data);
    bridgeRetry.disabled = false;
    bridgeRetry.textContent = 'Connect';
    return;
  }

  // Connection failed - check if Safari mixed content issue
  // Safari on HTTPS can't reliably detect HTTP servers due to mixed content blocking
  // So we always show the setup option in this case
  const isHttps = window.location.protocol === 'https:';
  if (isSafari && isHttps && url.startsWith('http://')) {
    const setupUrl = `${url}/setup`;
    const popup = window.open(setupUrl, '_blank');

    if (!popup || popup.closed) {
      // Popup blocked - show manual link in overlay
      const hint = document.createElement('p');
      hint.className = 'bridge-popup-hint';
      hint.innerHTML = `Safari requires HTTPS. <a href="${setupUrl}" target="_blank">Click here to set up secure access</a>`;

      const existingHint = bridgeOverlay.querySelector('.bridge-popup-hint');
      if (existingHint) existingHint.remove();

      bridgeOverlay.querySelector('.bridge-overlay-content').appendChild(hint);
    }
  }

  const elapsed = Date.now() - start;
  if (elapsed < 1000) {
    await new Promise(r => setTimeout(r, 1000 - elapsed));
  }
  bridgeRetry.disabled = false;
  bridgeRetry.textContent = 'Connect';
});

// Listen for postMessage from setup page with HTTPS port
window.addEventListener('message', (event) => {
  console.log('[numthy] Received message:', event.data);
  if (event.data && event.data.type === 'numthy-https' && event.data.port) {
    const httpUrl = bridgeUrlEl.value.trim().replace(/\/$/, '');
    try {
      const url = new URL(httpUrl);
      const httpsUrl = `https://${url.hostname}:${event.data.port}`;
      localStorage.setItem(STORAGE_KEYS.bridgeHttpsUrl, httpsUrl);
      activeBridgeUrl = httpsUrl;
      refreshBackendInfo();
    } catch {
      // Invalid URL, ignore
    }
  }
});


// --- Gemini auth overlay handlers ---

geminiAuthSubmit.addEventListener('click', async () => {
  const code = geminiAuthCode.value.trim();
  if (!code) {
    geminiAuthError.textContent = 'Please paste the authorization code';
    geminiAuthError.classList.remove('hidden');
    return;
  }

  geminiAuthSubmit.disabled = true;
  geminiAuthSubmit.textContent = 'Verifying ...';
  geminiAuthError.classList.add('hidden');

  try {
    await exchangeGeminiCode(code);
    geminiAuthOverlay.classList.add('hidden');
    geminiAuthSubmit.disabled = false;
    geminiAuthSubmit.textContent = 'Continue';

    // Resume pending query
    if (pendingGeminiQuery) {
      const { prompt, model } = pendingGeminiQuery;
      pendingGeminiQuery = null;
      await executeGeminiQuery(prompt, model);
    }
  } catch (err) {
    geminiAuthError.textContent = err.message || 'Failed to verify code';
    geminiAuthError.classList.remove('hidden');
    geminiAuthSubmit.disabled = false;
    geminiAuthSubmit.textContent = 'Continue';
  }
});

geminiAuthCancel.addEventListener('click', () => {
  geminiAuthOverlay.classList.add('hidden');
  pendingGeminiQuery = null;
  showHome();
});

bridgeCancel.addEventListener('click', () => {
  bridgeOverlay.classList.add('hidden');
  showHome();
});

geminiAuthCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    geminiAuthSubmit.click();
  }
});

// Copy command to clipboard
const copyBtn = document.getElementById('copyBtn');
const bridgeCommand = document.querySelector('.bridge-command');

copyBtn.addEventListener('click', async () => {
  const text = bridgeCommand.textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.classList.add('copied');
    setTimeout(() => {
      copyBtn.classList.remove('copied');
    }, 2000);
  } catch (err) {
    console.error('Failed to copy:', err);
  }
});
