// Arithmetic grammar and exact-decimal evaluation. No catalogue, UI or storage dependencies.
export const keyPattern = /^[a-z][a-z0-9_]{0,39}$/;
/** Function name → [fewest, most] arguments. */
export const formulaFunctions = {
  CEILING: [1, 2],
  FLOOR: [1, 2],
  ROUNDUP: [2, 2],
  ROUND: [2, 2],
  SUM: [1, 50],
  ABS: [1, 1],
  MIN: [2, 10],
  MAX: [2, 10],
  IF: [3, 3],
};
const comparisons = ['==', '!=', '>', '<', '>=', '<='];
const priority = { '==': 1, '!=': 1, '>': 1, '<': 1, '>=': 1, '<=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
// ---------------------------------------------------------------- formulas

/** Parse a formula into a tree: { op, args }. Names stay lowercase; functions are upper case. */
export function parseFormula(source) {
  if (typeof source !== 'string' || !source.trim() || source.length > 1500)
    throw Error('Formula is empty or too long.');
  const tokens = [];
  let pos = 0;
  while (pos < source.length) {
    const rest = source.slice(pos);
    const m = /^\s*(\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|==|!=|[+*/(),<>-])/.exec(rest);
    if (!m) {
      if (!rest.trim()) break;
      throw Error('Unsupported formula symbol near "' + rest.trim().slice(0, 12) + '".');
    }
    tokens.push(m[1]);
    pos += m[0].length;
  }
  let i = 0,
    count = 0;
  const node = (op, args) => ({ op, args });
  function expression(min = 0, depth = 0) {
    if (depth > 32 || ++count > 256) throw Error('Formula is too complex.');
    let n;
    const t = tokens[i++];
    if (t === undefined) throw Error('Formula is incomplete.');
    if (t === '-') n = node('-', [node('number', ['0']), expression(4, depth + 1)]);
    else if (t === '(') {
      n = expression(0, depth + 1);
      if (tokens[i++] !== ')') throw Error('Close the formula bracket.');
    } else if (/^\d/.test(t)) {
      checkLiteral(t);
      n = node('number', [canonical(decimal(t))]);
    } else if (/^[A-Za-z_]/.test(t)) {
      if (tokens[i] === '(') {
        i++;
        const name = t.toUpperCase();
        if (!formulaFunctions[name]) throw Error('Unknown function: ' + t);
        const args = [];
        if (tokens[i] !== ')')
          for (;;) {
            args.push(expression(0, depth + 1));
            if (tokens[i] !== ',') break;
            i++;
          }
        if (tokens[i++] !== ')') throw Error('Close the bracket after ' + name + '.');
        const [lo, hi] = formulaFunctions[name];
        if (args.length < lo || args.length > hi)
          throw Error(`${name} takes ${lo === hi ? lo : `${lo} to ${hi}`} value${hi === 1 ? '' : 's'}.`);
        n = node(name, args);
      } else {
        if (!keyPattern.test(t)) throw Error(`Use lowercase letters, numbers and _ in names: ${t}`);
        n = node('name', [t]);
      }
    } else throw Error('Unexpected "' + t + '" in the formula.');
    while (i < tokens.length && priority[tokens[i]] !== undefined && priority[tokens[i]] >= min) {
      const op = tokens[i++];
      n = node(op, [n, expression(priority[op] + 1, depth + 1)]);
    }
    return n;
  }
  const tree = expression();
  if (i !== tokens.length) throw Error('Check the formula near "' + tokens[i] + '".');
  return tree;
}
function checkLiteral(t) {
  if ((t.split('.')[1]?.length ?? 0) > 12) throw Error('Formula numbers allow up to 12 decimal places.');
  if (t.replace('.', '').replace(/^0+/, '').length > 25 || Number(t) > 1e12)
    throw Error('Formula number is too large.');
}
/** Names a formula refers to, in order of first use. */
export function formulaNames(tree, out = []) {
  if (tree.op === 'name') {
    if (!out.includes(tree.args[0])) out.push(tree.args[0]);
  } else if (tree.op !== 'number') for (const a of tree.args) formulaNames(a, out);
  return out;
}
/** Formula text from a tree (used to compare a generated formula with its method). */
export function formulaText(n) {
  if (n.op === 'number') return n.args[0];
  if (n.op === 'name') return n.args[0];
  if (formulaFunctions[n.op]) return `${n.op}(${n.args.map(formulaText).join(', ')})`;
  return `(${formulaText(n.args[0])} ${n.op} ${formulaText(n.args[1])})`;
}

// ---------------------------------------------------------------- exact decimals
// A value is a fraction { n, d } of BigInts with d > 0.
const S = 1000000000000n; // 12 decimal places
const LIMIT = 1000000000000n;
export function decimal(value) {
  if (value && typeof value === 'object' && 'n' in value) return value;
  const text = String(value).trim().toLowerCase();
  if (!/^-?\d+(\.\d+)?(e[-+]?\d+)?$/.test(text)) throw Error('Enter a valid number.');
  const [coefficient, exponent = '0'] = text.split('e');
  const negative = coefficient.startsWith('-');
  const [whole, fraction = ''] = coefficient.replace('-', '').split('.');
  let n = BigInt(whole + fraction),
    d = 10n ** BigInt(fraction.length);
  const e = Number(exponent);
  if (Math.abs(e) > 30) throw Error('Number is outside the supported range.');
  if (e >= 0) n *= 10n ** BigInt(e);
  else d *= 10n ** BigInt(-e);
  return { n: negative ? -n : n, d };
}
const floorDiv = (n, d) => (n >= 0n ? n / d : -((-n + d - 1n) / d));
/** Round half up (towards +∞ at exactly .5) to 12 places, as the server does. */
const round12 = (r) => ({ n: floorDiv(2n * r.n * S + r.d, 2n * r.d), d: S });
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const mul = (a, b) => ({ n: a.n * b.n, d: a.d * b.d });
function div(a, b) {
  if (!b.n) throw Error('A formula divides by zero.');
  const r = { n: a.n * b.d, d: a.d * b.n };
  return r.d < 0n ? { n: -r.n, d: -r.d } : r;
}
const cmp = (a, b) => {
  const x = a.n * b.d - b.n * a.d;
  return x > 0n ? 1 : x < 0n ? -1 : 0;
};
const isZero = (a) => a.n === 0n;
const ceilFrac = (a) => ({ n: -floorDiv(-a.n, a.d), d: 1n });
// Rounding steps ignore leftovers below 9 decimal places, so 2/3*3 rounds up to 2, not 3.
const G = 1000000000n;
const snap = (r) => ({ n: floorDiv(2n * r.n * G + r.d, 2n * r.d), d: G });
/** CEILING/FLOOR of x to a positive step. */
const toStep = (x, step, up) => {
  const q = snap(div(x, step));
  return mul(up ? ceilFrac(q) : floorFrac(q), step);
};
const floorFrac = (a) => ({ n: floorDiv(a.n, a.d), d: 1n });
const absFrac = (a) => (a.n < 0n ? { n: -a.n, d: a.d } : a);
const pow10 = (k) => (k >= 0 ? { n: 10n ** BigInt(k), d: 1n } : { n: 1n, d: 10n ** BigInt(-k) });
const ZERO = { n: 0n, d: 1n },
  ONE = { n: 1n, d: 1n },
  HUNDRED = { n: 100n, d: 1n };
function inRange(r) {
  if (r.n > LIMIT * r.d || r.n < -LIMIT * r.d) throw Error('Calculation exceeds supported limits.');
  return r;
}
/** Shortest exact text of a 12-place value: "10.5", "0", "-3.25". */
export function canonical(value) {
  const r = round12(decimal(value));
  const negative = r.n < 0n;
  const abs = negative ? -r.n : r.n;
  const whole = abs / S,
    fraction = (abs % S).toString().padStart(12, '0').replace(/0+$/, '');
  if (!whole && !fraction) return '0';
  return (negative ? '-' : '') + whole.toString() + (fraction ? '.' + fraction : '');
}
export const toNumber = (value) => {
  const r = decimal(value);
  return Number(r.n) / Number(r.d);
};

/** Evaluate a tree. `resolve(name)` returns a decimal. Results are rounded to 12 places. */
export function evaluate(tree, resolve, depth = 0) {
  if (depth > 64) throw Error('Formula is too complex.');
  const { op, args } = tree;
  if (op === 'number') return decimal(args[0]);
  if (op === 'name') return decimal(resolve(args[0]));
  const ev = (n) => evaluate(n, resolve, depth + 1);
  let r;
  if (op === 'IF') return ev(args[isZero(ev(args[0])) ? 2 : 1]);
  const v = args.map(ev);
  switch (op) {
    case '+':
      r = add(v[0], v[1]);
      break;
    case '-':
      r = sub(v[0], v[1]);
      break;
    case '*':
      r = mul(v[0], v[1]);
      break;
    case '/':
      r = div(v[0], v[1]);
      break;
    case '>':
    case '<':
    case '>=':
    case '<=':
    case '==':
    case '!=': {
      const c = cmp(snap(v[0]), snap(v[1]));
      const yes = { '>': c > 0, '<': c < 0, '>=': c >= 0, '<=': c <= 0, '==': c === 0, '!=': c !== 0 }[op];
      r = yes ? ONE : ZERO;
      break;
    }
    case 'CEILING':
    case 'FLOOR': {
      const step = v[1] ?? ONE;
      if (cmp(step, ZERO) <= 0) throw Error(op + ': the rounding step must be more than zero.');
      r = toStep(v[0], step, op === 'CEILING');
      break;
    }
    case 'ROUND':
    case 'ROUNDUP': {
      const places = v[1];
      if (places.d !== 1n && places.n % places.d !== 0n)
        throw Error(op + ': decimal places must be a whole number.');
      const k = Number(places.n / places.d);
      if (k < -6 || k > 6) throw Error(op + ': decimal places must be from -6 to 6.');
      const scaled = snap(mul(absFrac(v[0]), pow10(k)));
      const whole = op === 'ROUND' ? floorFrac(add(scaled, { n: 1n, d: 2n })) : ceilFrac(scaled);
      r = div(whole, pow10(k));
      if (v[0].n < 0n) r = { n: -r.n, d: r.d };
      break;
    }
    case 'SUM':
      r = v.reduce(add, ZERO);
      break;
    case 'ABS':
      r = absFrac(v[0]);
      break;
    case 'MIN':
      r = v.reduce((a, b) => (cmp(b, a) < 0 ? b : a));
      break;
    case 'MAX':
      r = v.reduce((a, b) => (cmp(b, a) > 0 ? b : a));
      break;
    default:
      throw Error('Unsupported formula.');
  }
  return inRange(round12(r));
}

export { floorDiv, round12, add, sub, mul, div, toStep, ZERO, ONE, HUNDRED };
