// Small unified-style line diff for plan output (LCS; large inputs are summarised, not diffed).
export function unifiedDiff(a, b, name = 'file') {
  const x = a.split('\n'), y = b.split('\n');
  if (x.length * y.length > 4_000_000) return `(diff omitted: ${x.length} -> ${y.length} lines)`;
  const n = x.length, m = y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [`--- ${name} (before)`, `+++ ${name} (after)`];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) { i++; j++; continue; }
    if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) out.push('+' + y[j++]); else out.push('-' + x[i++]);
  }
  return out.join('\n');
}
