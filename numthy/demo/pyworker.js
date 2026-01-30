// pyworker.js — Web Worker for Pyodide execution (can be terminated to cancel)

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/';
const NUMTHY_URL = 'https://raw.githubusercontent.com/ini/numthy/main/numthy.py';

let pyodide = null;

const RUNNER_PY = `
import ast
import io
import sys
import contextlib
from fractions import Fraction

import numthy

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

_env = None
`;

async function init() {
  importScripts(`${PYODIDE_CDN}pyodide.js`);
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

  const response = await fetch(NUMTHY_URL);
  if (!response.ok) throw new Error('Failed to fetch numthy.py');
  const numthyCode = await response.text();
  pyodide.FS.writeFile('/home/pyodide/numthy.py', numthyCode);

  pyodide.runPython(RUNNER_PY);
}

function reset() {
  pyodide.runPython(`_env = dict(BASE_ENV)`);
}

function exec(code) {
  const result = pyodide.runPython(`
import json
_r = eval_expression(${JSON.stringify(code)}, _env)
json.dumps(_r)
`);
  return JSON.parse(result);
}

self.onmessage = async (e) => {
  const { type, code } = e.data;

  try {
    if (type === 'init') {
      self.postMessage({ type: 'status', message: 'Loading Python ...' });
      await init();
      self.postMessage({ type: 'ready' });
    } else if (type === 'exec') {
      reset();
      const result = exec(code);
      self.postMessage({ type: 'result', result });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
