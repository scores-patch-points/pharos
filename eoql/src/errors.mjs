// errors.mjs: typed errors, codes, versions (SPEC 5.3, 5.1).
export const VERSION = Object.freeze({
  language: 'eoql/1', result: 'eoql-result/1', receipt: 'eoql-receipt/1', dump: 'eoql-dump/1',
  manifest: 'eoql-manifest/1', plan: 'eoql-plan/1', parse: 'eoql-parse/1', compile: 'eoql-compile/1', dialect: 'eoql-dialect/1', fn: 'eoql-fn/1', json: 'eoql-json/1', sqldump: 'eoql-sqldump/1', import: 'eoql-import/1', cube: 'eoql-cube/1', cells: 'eoql-cells/1',
});

const ERRS = ['E_PARSE', 'E_LIMIT', 'E_UNKNOWN_VERB', 'E_UNKNOWN_CLAUSE', 'E_BAD_CLAUSE_VALUE', 'E_UNKNOWN_FUNC', 'E_ARITY', 'E_TYPE', 'E_RANGE',
  'E_BIND_NAME', 'E_BIND_FIELD', 'E_AMBIGUOUS_REF', 'E_CYCLE', 'E_LABEL', 'E_PARAM', 'E_FRAME', 'E_FRAME_DERIVED', 'E_READONLY',
  'E_UNDECLARED_KIND', 'E_VERB_KIND', 'E_COMPUTED_FIELD', 'E_CELL_TYPED', 'E_BAD_OF', 'E_VIEW_BODY', 'E_ID_MISMATCH', 'E_NOT_PRIMARY',
  'E_SOURCE', 'E_SOURCE_CAP', 'E_BUDGET', 'E_IMPORT', 'E_EXPORT', 'E_NOT_REPRESENTABLE', 'E_BASIS_REQUIRED', 'E_LOSSY', 'E_SQL_UNSUPPORTED', 'E_USAGE', 'E_INTERNAL', 'E_NOT_COMPILABLE', 'E_TARGET_UNIMPLEMENTED', 'E_UNKNOWN_CELL', 'E_UNKNOWN_OP', 'E_UNKNOWN_GRAIN', 'E_GRAIN_NOT_APPLICABLE', 'E_WRITER_NAME'];
const WARNS = ['W_NO_FIELD', 'W_GLYPH', 'W_ORDER_KEY', 'W_SCHEMA_HELD', 'W_VIEW_HELD', 'W_BLIND_WRITE', 'W_OF_UNCHECKED', 'W_CUT_OPEN', 'W_ANC_SLOT', 'W_LOSSY', 'W_UNRESOLVED_REF', 'W_LEGACY_GAP', 'W_UNORDERED_PAGE', 'W_AGG_ORDER', 'W_VERSION', 'W_NULL_SEMANTICS', 'W_KEYWORDS', 'W_UNKNOWN_CELL_LITERAL', 'W_GROUND_HELD', 'W_CUBE_NO_CELL', 'W_GRAIN_SLOT_MIXED'];
const GAPS = ['SQL_CORRELATED_SCALAR', 'SQL_CORRELATED_OTHER', 'SQL_NATURAL_JOIN', 'SQL_TABLE_FUNCTION', 'SQL_WINDOW_FRAME', 'SQL_BARE_COLUMN', 'SQL_RECURSIVE_SHAPE', 'SQL_ROWID', 'SQL_BLOB', 'SQL_COLLATION', 'SQL_NONDETERMINISTIC', 'SQL_DATE_FORMAT', 'SQL_JSON_OPERATOR', 'SQL_IS_TRUE', 'SQL_AFFINITY', 'SQL_DDL', 'SQL_MULTI_STATEMENT', 'SQL_UPDATE', 'SQL_INSERT_SHAPE', 'SQL_RETURNING', 'SQL_UPSERT',
  'SQL_CATALOG_UNKNOWN', 'SQL_GROUPING_SETS', 'SQL_ARRAY_AGG', 'SQL_AGG_ORDER', 'SQL_CONNECT_BY', 'SQL_DISTINCT_ON', 'SQL_DIALECT_SPELLING', 'SQL_V1_HOSTFN', 'SQL_COLUMN_UNKNOWN', 'SQL_AMBIGUOUS_COLUMN', 'SQL_UNKNOWN_FUNCTION', 'SQL_UNSUPPORTED_EXPR', 'SQL_WRITE_NOT_BUILT'];
export const CODES = Object.freeze(Object.fromEntries([...ERRS, ...WARNS, ...GAPS].map((c) => [c, c])));

export class EoqlError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.name = 'EoqlError';
    this.code = code;
    if (extra && extra.pos !== undefined) this.pos = extra.pos;
    if (extra && extra.detail !== undefined) this.detail = extra.detail;
  }
  toJSON() { return { code: this.code, message: this.message, ...(this.pos !== undefined ? { pos: this.pos } : {}), ...(this.detail !== undefined ? { detail: this.detail } : {}) }; }
}
export const err = (code, message, extra) => new EoqlError(code, message, extra);

// Anything that is not an EoqlError is wrapped (L19: functions never throw anything else).
export function wrap(e) {
  if (e instanceof EoqlError) return e;
  if (e && e.name === 'RangeError' && /call stack/i.test(String(e.message))) return new EoqlError('E_LIMIT', 'nesting too deep');
  const code = e && typeof e.code === 'string' && /^E_/.test(e.code) ? e.code : 'E_INTERNAL';
  return new EoqlError(code, String(e && e.message ? e.message : e), { detail: { cause: e && e.name } });
}
