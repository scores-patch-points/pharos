// Shared by the rig and the recording shims. Classifies a tool call as read-class (detect-style,
// answers from canned output) or mutating (always blocked, fail closed).
export const SHIMMED = ['brew', 'curl', 'wget', 'launchctl', 'ollama', 'npm', 'opencode', 'sudo', 'docker', 'git', 'claude', 'open', 'lsof'];

const VERSION_FORMS = new Set(['--version', '-v', '-V', 'version', '--help', '-h', 'help']);
const READ_SUB = {
  ollama: ['list', 'ps', 'show'],
  brew: ['list', 'ls', '--prefix', '--cellar', '--version'],
  npm: ['ls', 'list', 'root', 'prefix', 'bin'],
  launchctl: ['getenv', 'list', 'print'],
  git: ['rev-parse', 'status', 'log', 'describe', 'ls-files', 'cat-file', 'branch', 'show', 'remote'],
  docker: ['ps', 'images', 'version', 'info'],
  claude: [],
  opencode: [],
};

export function classify(tool, argv) {
  if (tool === 'lsof') return 'read';
  if (argv.length === 1 && VERSION_FORMS.has(argv[0])) return 'read';
  const sub = argv.find((a) => !a.startsWith('-')) ?? argv[0];
  if (tool === 'npm' && argv[0] === 'config' && argv[1] === 'get') return 'read';
  if (tool === 'git' && argv[0] === 'config' && argv.includes('--get')) return 'read';
  if (tool === 'claude' && argv[0] === 'plugin' && argv[1] === 'list') return 'read';
  if (tool === 'brew' && argv[0] === 'services' && argv[1] === 'list') return 'read';
  if (READ_SUB[tool]?.includes(sub) && sub === argv[0]) return 'read';
  return 'mutating';
}

export function isVersionForm(argv) {
  return argv.length === 1 && VERSION_FORMS.has(argv[0]);
}
