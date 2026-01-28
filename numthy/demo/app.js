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

// Safari detection - Safari blocks mixed content (HTTP from HTTPS page)
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

let currentSource = null;
let availableBackends = [];
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
  'Solve 5^x = 7 mod 13',
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
  promptEl.value = promptMiniEl.value;
  promptEl.focus();
}

function showResults() {
  homeEl.style.display = 'none';
  resultsViewEl.classList.remove('hidden');
  resultsViewEl.style.display = '';
  statusEl.style.display = '';
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
      expr.textContent = block.expr;
      shell.appendChild(expr);
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
  return { backend: 'codex', model: '' };
}

function buildUnifiedModelList() {
  unifiedModels = [];

  availableBackends.forEach((backend) => {
    if (backend.models && backend.models.length) {
      backend.models.forEach((model) => {
        unifiedModels.push({
          backend: backend.name,
          backendDisplayName: backend.displayName || backend.name,
          model: model.value,
          label: model.label,
        });
      });
    } else if (backend.defaultModel) {
      unifiedModels.push({
        backend: backend.name,
        backendDisplayName: backend.displayName || backend.name,
        model: backend.defaultModel,
        label: backend.defaultModel,
      });
    }
  });
}

function selectModel(value) {
  const model = unifiedModels.find((m) => `${m.backend}:${m.model}` === value);

  // If model not found, fall back to first available
  if (!model && unifiedModels.length > 0) {
    const fallback = unifiedModels[0];
    value = `${fallback.backend}:${fallback.model}`;
  }

  selectedModelValue = value;
  localStorage.setItem(STORAGE_KEYS.selectedModel, value);

  const actualModel = unifiedModels.find((m) => `${m.backend}:${m.model}` === value);
  modelPickerLabel.textContent = actualModel ? actualModel.label : 'Select model';

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

  Object.entries(grouped).forEach(([backendName, models]) => {
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
      btn.addEventListener('click', () => selectModel(btn.dataset.value));
      modelPickerMenu.appendChild(btn);
    });
  });

  // Restore saved selection or select first available
  const saved = localStorage.getItem(STORAGE_KEYS.selectedModel);
  if (saved && unifiedModels.some((m) => `${m.backend}:${m.model}` === saved)) {
    selectModel(saved);
  } else if (unifiedModels.length > 0) {
    selectModel(`${unifiedModels[0].backend}:${unifiedModels[0].model}`);
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
      const menuRect = modelPickerMenu.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const offset = selectedRect.top - menuRect.top - (menuRect.height / 2) + (selectedRect.height / 2);
      modelPickerMenu.scrollTop = offset;
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
  const bridgeUrl = getBridgeUrl();
  const selected = getSelectedModel();

  if (!prompt) return;

  localStorage.setItem(STORAGE_KEYS.bridgeUrl, bridgeUrl);
  promptMiniEl.value = prompt;

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
  refreshBackendInfo();
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
  promptEl.placeholder = '';

  let questionIndex = Math.floor(Math.random() * EXAMPLE_QUESTIONS.length);
  let charIndex = 0;
  let isDeleting = false;
  let pauseTime = 0;

  function tick() {
    if (!typewriterActive) return;

    const question = EXAMPLE_QUESTIONS[questionIndex];

    if (pauseTime > 0) {
      pauseTime -= 50;
      typewriterTimer = setTimeout(tick, 50);
      return;
    }

    if (isDeleting) {
      charIndex--;
      promptEl.placeholder = question.substring(0, charIndex);

      if (charIndex === 0) {
        isDeleting = false;
        questionIndex = (questionIndex + 1) % EXAMPLE_QUESTIONS.length;
        pauseTime = 300;
      }
      typewriterTimer = setTimeout(tick, 30);
    } else {
      charIndex++;
      promptEl.placeholder = question.substring(0, charIndex);

      if (charIndex === question.length) {
        isDeleting = true;
        pauseTime = 2000;
      }
      typewriterTimer = setTimeout(tick, 60);
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
  promptEl.focus();
  refreshBackendInfo();
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

async function refreshBackendInfo() {
  const bridgeUrl = bridgeUrlEl.value.trim().replace(/\/$/, '');
  if (!bridgeUrl) {
    bridgeOverlay.classList.remove('hidden');
    startAutoRetry();
    return;
  }

  // 1. Try HTTP fetch first (works for Chrome)
  let data = await tryFetch(bridgeUrl);
  if (data) {
    activeBridgeUrl = bridgeUrl;
    onConnected(data);
    return;
  }

  // 2. Try saved HTTPS URL (Safari returning user)
  const savedHttpsUrl = getHttpsUrl(bridgeUrl);
  if (savedHttpsUrl) {
    data = await tryFetch(savedHttpsUrl);
    if (data) {
      activeBridgeUrl = savedHttpsUrl;
      onConnected(data);
      return;
    }
  }

  // 3. Not connected - show overlay with instructions
  bridgeOverlay.classList.remove('hidden');
  startAutoRetry();
}

function onConnected(data) {
  bridgeOverlay.classList.add('hidden');
  stopAutoRetry();

  if (data.backends && Array.isArray(data.backends)) {
    availableBackends = data.backends;
    buildUnifiedModelList();
    renderModelPicker();
    updateMiniSearchMargin();
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
  refreshBackendInfo();
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

  // Try to connect
  const data = await tryFetch(url);
  if (data) {
    activeBridgeUrl = url;
    onConnected(data);
    bridgeRetry.disabled = false;
    bridgeRetry.textContent = 'Connect';
    return;
  }

  // Connection failed
  if (isSafari && url.startsWith('http://')) {
    // Safari with HTTP: open setup page to get HTTPS
    window.open(`${url}/setup`, '_blank');
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
