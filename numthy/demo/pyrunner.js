// pyrunner.js — Pyodide loader + Python executor for NumThy

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';
const NUMTHY_URL = 'https://raw.githubusercontent.com/ini/numthy/main/numthy.py';

let pyodide = null;
let pyodideLoading = null;

// Stripped-down runner (no SIGALRM, no memory limits, no import restriction — Pyodide sandbox handles safety)
const RUNNER_PY = `
import ast
import io
import sys
import contextlib
from fractions import Fraction

import numthy

# --- Environment setup ---

import builtins as _builtins

NUMTHY_GLOBALS = {}
for name in getattr(numthy, '__all__', []):
    obj = getattr(numthy, name, None)
    if obj is not None:
        NUMTHY_GLOBALS[name] = obj

BASE_ENV = {
    '__builtins__': _builtins.__dict__,
    'nt': numthy,
    'numthy': numthy,
    **NUMTHY_GLOBALS,
    'Fraction': Fraction,
}

# --- Result formatting ---

def format_blocks(value, stdout_text=''):
    blocks = []
    if stdout_text:
        blocks.append({'type': 'text', 'content': stdout_text.strip()})
    if value is None:
        return blocks
    if isinstance(value, dict):
        headers = ['key', 'value']
        rows = [[str(k), str(v)] for k, v in value.items()]
        blocks.append({'type': 'table', 'content': {'headers': headers, 'rows': rows}})
    elif isinstance(value, (list, tuple)) and value and isinstance(value[0], (list, tuple)):
        ncols = max(len(r) for r in value) if value else 0
        headers = [str(i) for i in range(ncols)]
        rows = [[str(c) for c in row] for row in value]
        blocks.append({'type': 'table', 'content': {'headers': headers, 'rows': rows}})
    else:
        blocks.append({'type': 'text', 'content': str(value)})
    return blocks

# --- Expression evaluation ---

def eval_expression(expr, env):
    try:
        tree = ast.parse(expr)
    except SyntaxError as e:
        return {'ok': False, 'error': f'Syntax error: {e}', 'blocks': []}

    stdout_capture = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout_capture):
            body = tree.body
            if len(body) == 1 and isinstance(body[0], ast.Expr):
                code = compile(ast.Expression(body[0].value), '<step>', 'eval')
                value = eval(code, env)
            else:
                code = compile(tree, '<step>', 'exec')
                exec(code, env)
                value = None
        stdout_text = stdout_capture.getvalue()
        blocks = format_blocks(value, stdout_text)
        return {'ok': True, 'blocks': blocks}
    except Exception as e:
        return {'ok': False, 'error': str(e), 'blocks': []}

# --- Step runner ---

_env = None

def run_steps(expressions, reset=True):
    global _env
    if reset or _env is None:
        _env = dict(BASE_ENV)
    results = []
    for expr in expressions:
        result = eval_expression(expr, _env)
        results.append(result)
    return results
`;

/**
 * Initialize Pyodide and load numthy. Lazy — called on first query.
 * @param {function} [onStatus] - Callback for status updates
 * @returns {Promise<void>}
 */
async function initPyodide(onStatus) {
  if (pyodide) return;
  if (pyodideLoading) return pyodideLoading;

  pyodideLoading = (async () => {
    if (onStatus) onStatus('Loading Python ...');

    // Dynamically load Pyodide script if not already present
    if (typeof loadPyodide === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${PYODIDE_CDN}pyodide.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Pyodide'));
        document.head.appendChild(script);
      });
    }

    pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

    // Fetch numthy.py and write to virtual filesystem
    const response = await fetch(NUMTHY_URL);
    if (!response.ok) throw new Error('Failed to fetch numthy.py');
    const numthyCode = await response.text();
    pyodide.FS.writeFile('/home/pyodide/numthy.py', numthyCode);

    // Load runner into Pyodide
    pyodide.runPython(RUNNER_PY);
  })();

  await pyodideLoading;
}

/**
 * Execute a single Python expression and return result blocks.
 * @param {string} expr - Python expression
 * @param {boolean} [reset=false] - Reset environment
 * @returns {Promise<{ok: boolean, blocks: Array, error?: string}>}
 */
async function pyExec(expr, reset = false) {
  if (!pyodide) throw new Error('Pyodide not initialized');

  const result = await pyodide.runPythonAsync(`
import json
_r = eval_expression(${JSON.stringify(expr)}, _env)
json.dumps(_r)
`);

  return JSON.parse(result);
}

/**
 * Reset the Python environment (call before a new query).
 */
function pyReset() {
  if (!pyodide) return;
  pyodide.runPython(`_env = dict(BASE_ENV)`);
}

/**
 * Check if Pyodide is loaded.
 */
function isPyodideReady() {
  return pyodide !== null;
}
