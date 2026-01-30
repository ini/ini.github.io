// gemini.js — Fully client-side Gemini via Code Assist API (no server needed)

const CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'https://codeassist.google.com/authcode';
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

const GEMINI_STORAGE_KEYS = {
  accessToken: 'numthy.gemini.accessToken',
  refreshToken: 'numthy.gemini.refreshToken',
  expiresAt: 'numthy.gemini.expiresAt',
  projectId: 'numthy.gemini.projectId',
  codeVerifier: 'numthy.gemini.codeVerifier',
};

// --- PKCE Helpers ---

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// --- Token Management ---

function getStoredTokens() {
  const accessToken = localStorage.getItem(GEMINI_STORAGE_KEYS.accessToken);
  const refreshToken = localStorage.getItem(GEMINI_STORAGE_KEYS.refreshToken);
  const expiresAt = parseInt(localStorage.getItem(GEMINI_STORAGE_KEYS.expiresAt) || '0', 10);
  return { accessToken, refreshToken, expiresAt };
}

function storeTokens(accessToken, refreshToken, expiresIn) {
  localStorage.setItem(GEMINI_STORAGE_KEYS.accessToken, accessToken);
  if (refreshToken) {
    localStorage.setItem(GEMINI_STORAGE_KEYS.refreshToken, refreshToken);
  }
  localStorage.setItem(GEMINI_STORAGE_KEYS.expiresAt, String(Date.now() + (expiresIn - 60) * 1000));
}

function clearTokens() {
  Object.values(GEMINI_STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

function getStoredProjectId() {
  return localStorage.getItem(GEMINI_STORAGE_KEYS.projectId);
}

function storeProjectId(projectId) {
  if (projectId) {
    localStorage.setItem(GEMINI_STORAGE_KEYS.projectId, projectId);
  }
}

// --- Auth Flow ---

function checkGeminiAuth() {
  const { accessToken, refreshToken, expiresAt } = getStoredTokens();
  // Consider authenticated if we have a valid token or a refresh token
  if (accessToken && Date.now() < expiresAt) return true;
  if (refreshToken) return true;
  return false;
}

async function startGeminiAuth() {
  const codeVerifier = generateCodeVerifier();
  localStorage.setItem(GEMINI_STORAGE_KEYS.codeVerifier, codeVerifier);

  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeGeminiCode(code) {
  const codeVerifier = localStorage.getItem(GEMINI_STORAGE_KEYS.codeVerifier);
  if (!codeVerifier) {
    throw new Error('No pending auth flow');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  storeTokens(data.access_token, data.refresh_token, data.expires_in);
  localStorage.removeItem(GEMINI_STORAGE_KEYS.codeVerifier);
}

async function refreshAccessToken() {
  const { refreshToken } = getStoredTokens();
  if (!refreshToken) return null;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json();

  if (data.error) {
    clearTokens();
    return null;
  }

  storeTokens(data.access_token, null, data.expires_in);
  return data.access_token;
}

async function getAccessToken() {
  const { accessToken, expiresAt } = getStoredTokens();

  if (accessToken && Date.now() < expiresAt) {
    return accessToken;
  }

  // Try to refresh
  const newToken = await refreshAccessToken();
  if (newToken) return newToken;

  throw new Error('AUTH_REQUIRED');
}

// --- Code Assist API ---

async function codeAssistRequest(method, body, accessToken) {
  const response = await fetch(`https://cloudcode-pa.googleapis.com/v1internal:${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || `API error (${response.status})`);
  }

  return data;
}

async function setupUser(accessToken) {
  let projectId = getStoredProjectId();
  if (projectId) return projectId;

  const metadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
  };

  const loadRes = await codeAssistRequest('loadCodeAssist', { metadata }, accessToken);

  if (loadRes.cloudaicompanionProject) {
    storeProjectId(loadRes.cloudaicompanionProject);
    return loadRes.cloudaicompanionProject;
  }

  // Onboard to free tier
  const allowedTiers = loadRes.allowedTiers || [];
  const defaultTier = allowedTiers.find(t => t.isDefault) || { id: 'FREE' };

  const onboardRes = await codeAssistRequest('onboardUser', {
    tierId: defaultTier.id,
    metadata,
  }, accessToken);

  if (onboardRes.name && !onboardRes.done) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  projectId = onboardRes.response?.cloudaicompanionProject?.id || null;
  storeProjectId(projectId);
  return projectId;
}

async function geminiGeneratePlan(userPrompt, model) {
  const accessToken = await getAccessToken();
  const projectId = await setupUser(accessToken);

  const plannerPrompt = buildGeminiPrompt(userPrompt);

  const requestBody = {
    model: model || GEMINI_DEFAULT_MODEL,
    project: projectId,
    request: {
      contents: [{ role: 'user', parts: [{ text: plannerPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: PLAN_SCHEMA,
      },
    },
  };

  const response = await codeAssistRequest('generateContent', requestBody, accessToken);
  const text = response.response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const parsed = extractJSON(text);
  return normalizePlan(parsed);
}

// --- Hosted bridge compatibility (no-op, everything is client-side now) ---

function checkHostedBridge() {
  return Promise.resolve(true);
}

// --- Gemini models (use var for global scope in non-module scripts) ---

var GEMINI_MODELS = [
  { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', isDefault: true },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

var GEMINI_DEFAULT_MODEL = 'gemini-3-flash-preview';
