// Test world for scripts/update.sh: a fake SkyGlass install in a temp dir,
// release tarballs, and stub pm2/npm/curl/pip executables first on PATH.
// Stubs are steered by env vars (see STUBS below) and log their calls to
// <world>/stub-logs/*.log. Used by scripts/tests/*.test.mjs (node --test).
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../..');
export const UPDATE_SH = path.join(REPO_ROOT, 'scripts/update.sh');

const OLD = '1.0.0';
const NEW = '2.0.0';
export const VERSIONS = { OLD, NEW };

// Runtime state that an update must never change
const RUNTIME_FILES = [
  'data/skyglass.db',
  'config/config.yaml',
  'packages/presence/face_data/x',
  '.env',
];

const STUBS = {
  // pm2: logs every call; startOrRestart/restart fail while VERSION on disk is
  // PM2_FAIL_VERSION. PM2_KILL_ON_STOP=N / PM2_KILL_ON_START=N SIGKILL the
  // lock holder on the Nth `stop` / `startOrRestart` (crash simulation).
  pm2: `#!/bin/bash
echo "$*" >> "$STUB_LOGS/pm2.log"
kill_holder() { kill -9 "$(cat "$PROJECT/.update-lock/pid")" 2>/dev/null; }
case "$1" in
  stop)
    n=$(grep -c '^stop' "$STUB_LOGS/pm2.log")
    [ -n "$PM2_KILL_ON_STOP" ] && [ "$n" = "$PM2_KILL_ON_STOP" ] && kill_holder
    ;;
  startOrRestart)
    n=$(grep -c '^startOrRestart' "$STUB_LOGS/pm2.log")
    [ -n "$PM2_KILL_ON_START" ] && [ "$n" = "$PM2_KILL_ON_START" ] && kill_holder
    [ -n "$PM2_FAIL_VERSION" ] && [ "$(cat "$PROJECT/VERSION")" = "$PM2_FAIL_VERSION" ] && exit 1
    ;;
  restart)
    [ -n "$PM2_FAIL_VERSION" ] && [ "$(cat "$PROJECT/VERSION")" = "$PM2_FAIL_VERSION" ] && exit 1
    ;;
esac
exit 0
`,
  // npm: NPM_MODE = ok | mutate | fail | netdrop | hang | term | kill9 | slow
  npm: `#!/bin/bash
echo "$*" >> "$STUB_LOGS/npm.log"
holder() { cat "$PROJECT/.update-lock/pid"; }
garbage() { rm -f node_modules/marker; echo garbage > node_modules/marker; mkdir -p node_modules/half-written; }
case "\${NPM_MODE:-ok}" in
  ok) exit 0 ;;
  mutate) rm -f node_modules/marker; echo new > node_modules/marker; exit 0 ;;
  fail) exit 1 ;;
  netdrop) garbage; echo "npm ERR! network ECONNRESET" >&2; exit 1 ;;
  hang) exec sleep 60 ;;
  term) garbage; kill -TERM "$(holder)"; exec sleep 60 ;;
  kill9) garbage; kill -9 "$(holder)"; exit 1 ;;
  slow) sleep "\${NPM_SLOW_SECS:-3}"; rm -f node_modules/marker; echo new > node_modules/marker; exit 0 ;;
esac
exit 0
`,
  // curl: health/UI of the mirror and the GitHub API/asset downloads.
  // HEALTH_MODE = healthy | never | flap:K (K healthy answers then down) |
  // ui500. It only applies while VERSION on disk is BAD_VERSION (if set), so
  // the old version is healthy again after a rollback.
  curl: `#!/bin/bash
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -m|--max-time) shift ;;
    http*) url="$1" ;;
  esac
  shift
done
echo "$url" >> "$STUB_LOGS/curl.log"
case "$url" in
  *api.github.com*) cat "$GH_RELEASE_JSON"; exit 0 ;;
  *.tar.gz) cp "$GH_TARBALL" "$out"; exit $? ;;
  *.sha256) [ -f "$GH_SHA256_FILE" ] || exit 22; cp "$GH_SHA256_FILE" "$out"; exit $? ;;
esac
mode="\${HEALTH_MODE:-healthy}"
if [ -n "$BAD_VERSION" ] && [ "$(cat "$PROJECT/VERSION" 2>/dev/null)" != "$BAD_VERSION" ]; then
  mode=healthy
fi
case "$url" in
  */api/health)
    echo x >> "$STUB_LOGS/health-calls"
    case "$mode" in
      never) exit 7 ;;
      flap:*) n=$(wc -l < "$STUB_LOGS/health-calls"); [ "$n" -le "\${mode#flap:}" ] || exit 7 ;;
    esac
    echo '{"status":"ok"}'; exit 0 ;;
  *)
    [ "$mode" = ui500 ] && exit 22
    echo '<!doctype html><html><body>mirror</body></html>'; exit 0 ;;
esac
`,
};

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  if (mode) fs.chmodSync(file, mode);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export class World {
  constructor() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-update-'));
    this.root = path.join(this.dir, 'SkyGlass');
    this.bin = path.join(this.dir, 'bin');
    this.logs = path.join(this.dir, 'stub-logs');
    this.releases = path.join(this.dir, 'releases');
    fs.mkdirSync(this.logs, { recursive: true });
    fs.mkdirSync(this.releases, { recursive: true });
    for (const [name, body] of Object.entries(STUBS)) write(path.join(this.bin, name), body, 0o755);
    this.buildInstall();
    this.runtimeBefore = this.runtimeHashes();
    this.env = {
      PATH: `${this.bin}:${process.env.PATH}`,
      HOME: this.dir,
      PROJECT: this.root,
      STUB_LOGS: this.logs,
      SKYGLASS_HEALTH_URL: 'http://mirror.test:3001/api/health',
      SKYGLASS_HEALTH_INTERVAL: '0',
      SKYGLASS_HEALTH_TIMEOUT: '3',
      SKYGLASS_HEALTH_STABLE_CHECKS: '3',
      SKYGLASS_UPDATE_DISK_MARGIN_MB: '0',
      SKYGLASS_NPM_TIMEOUT: '20',
    };
  }

  buildInstall() {
    const r = (p) => path.join(this.root, p);
    write(r('package.json'), '{\n  "name": "skyglass",\n  "version": "0.1.0"\n}\n');
    write(r('package-lock.json'), '{"lockfileVersion": 3, "deps": "v1"}\n');
    write(r('VERSION'), `${OLD}\n`);
    write(r('packages/backend/dist/server.js'), `// server ${OLD}\n`);
    write(r('packages/frontend/dist/index.html'), `<!doctype html><title>${OLD}</title>\n`);
    write(r('packages/presence/requirements.txt'), 'flask\n');
    write(r('config/pm2.config.cjs'), 'module.exports = { apps: [] };\n');
    write(r('old-only.txt'), 'only in v1\n');
    write(r('scripts/update.sh'), fs.readFileSync(UPDATE_SH));
    fs.chmodSync(r('scripts/update.sh'), 0o755);
    // runtime state
    write(r('data/skyglass.db'), crypto.randomBytes(256));
    write(r('config/config.yaml'), 'airport: KSEA\n');
    write(r('packages/presence/face_data/x'), crypto.randomBytes(64));
    write(r('.env'), 'SECRET=1\n');
    fs.mkdirSync(r('logs'), { recursive: true });
    write(r('node_modules/marker'), 'old\n');
    write(r('node_modules/pkg/index.js'), 'module.exports = 1;\n');
    write(r('packages/backend/node_modules/marker'), 'old\n');
  }

  /**
   * Build a release tarball (no top-level dir). Options:
   *   lockChanged: package-lock.json differs from the install's
   *   omit: relative paths left out
   *   kind: 'random' (random bytes) | 'truncated' (first half of a real one)
   */
  release({ version = NEW, lockChanged = false, omit = [], kind } = {}) {
    const name = `skyglass-v${version}-${crypto.randomBytes(3).toString('hex')}.tar.gz`;
    const tarball = path.join(this.releases, name);
    if (kind === 'random') {
      fs.writeFileSync(tarball, crypto.randomBytes(4096));
      return tarball;
    }
    const src = fs.mkdtempSync(path.join(this.dir, 'src-'));
    const s = (p) => path.join(src, p);
    const files = {
      'package.json': '{\n  "name": "skyglass",\n  "version": "0.1.0"\n}\n',
      'package-lock.json': lockChanged
        ? '{"lockfileVersion": 3, "deps": "v2"}\n'
        : '{"lockfileVersion": 3, "deps": "v1"}\n',
      VERSION: `${version}\n`,
      'packages/backend/dist/server.js': `// server ${version}\n`,
      'packages/frontend/dist/index.html': `<!doctype html><title>${version}</title>\n`,
      'packages/presence/requirements.txt': 'flask\n',
      'config/pm2.config.cjs': 'module.exports = { apps: [] };\n',
      'new-only.txt': `only in ${version}\n`,
    };
    for (const [p, c] of Object.entries(files)) if (!omit.includes(p)) write(s(p), c);
    if (!omit.includes('scripts/update.sh')) {
      write(s('scripts/update.sh'), fs.readFileSync(UPDATE_SH), 0o755);
    }
    execFileSync('tar', ['-czf', tarball, '-C', src, '.']);
    if (kind === 'truncated') {
      const buf = fs.readFileSync(tarball);
      fs.writeFileSync(tarball, buf.subarray(0, Math.floor(buf.length / 2)));
    }
    return tarball;
  }

  sha256(file) {
    return sha256(file);
  }

  /** Run update.sh synchronously; output goes to a file (no pipes to hang on). */
  run(args, extraEnv = {}, { timeout = 30000 } = {}) {
    const outFile = path.join(this.dir, `out-${Date.now()}-${Math.random()}.log`);
    const fd = fs.openSync(outFile, 'w');
    const started = Date.now();
    const res = spawnSync('bash', [path.join(this.root, 'scripts/update.sh'), ...args], {
      cwd: this.root,
      env: { ...this.env, ...extraEnv },
      stdio: ['ignore', fd, fd],
      timeout,
    });
    fs.closeSync(fd);
    return {
      status: res.status,
      signal: res.signal,
      ms: Date.now() - started,
      out: fs.readFileSync(outFile, 'utf8'),
    };
  }

  /** Start update.sh in the background; resolves {status, signal} on exit. */
  start(args, extraEnv = {}) {
    const outFile = path.join(this.dir, `bg-${Date.now()}.log`);
    const fd = fs.openSync(outFile, 'w');
    const child = spawn('bash', [path.join(this.root, 'scripts/update.sh'), ...args], {
      cwd: this.root,
      env: { ...this.env, ...extraEnv },
      stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    const done = new Promise((resolve) =>
      child.on('exit', (status, signal) => resolve({ status, signal }))
    );
    return { child, done };
  }

  async waitFor(pred, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timed out waiting for condition');
  }

  read(p) {
    const f = path.join(this.root, p);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  }

  exists(p) {
    return fs.existsSync(path.join(this.root, p));
  }

  version() {
    return (this.read('VERSION') || '').trim();
  }

  marker() {
    return (this.read('node_modules/marker') || '').trim();
  }

  runtimeHashes() {
    return Object.fromEntries(RUNTIME_FILES.map((p) => [p, sha256(path.join(this.root, p))]));
  }

  stubLog(name) {
    const f = path.join(this.logs, `${name}.log`);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : [];
  }

  updateLog() {
    return this.read('logs/update.log') || '';
  }

  cleanup() {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Common end-state assertions. */
export function assertEnd(assert, w, { version, marker, state = false, started = true, logLine }) {
  const ctx = `\n--- update.log ---\n${w.updateLog()}`;
  assert.equal(w.version(), version, `code version on disk${ctx}`);
  assert.equal(
    (w.read('packages/backend/dist/server.js') || '').trim(),
    `// server ${version}`,
    `backend code matches VERSION${ctx}`
  );
  if (version === OLD) {
    assert.equal(w.exists('new-only.txt'), false, `files added by the update removed${ctx}`);
  }
  assert.equal(w.exists('old-only.txt'), true, 'old file kept');
  assert.equal(w.marker(), marker, `node_modules marker${ctx}`);
  assert.equal(w.exists('node_modules/half-written'), false, `no half-written node_modules${ctx}`);
  assert.deepEqual(w.runtimeHashes(), w.runtimeBefore, 'runtime state byte-identical');
  assert.equal(w.exists('.update-state'), state, `.update-state presence${ctx}`);
  assert.equal(w.exists('.update-lock'), false, `lock released${ctx}`);
  assert.equal(w.exists('.update-stage'), false, 'stage dir cleaned');
  if (started === true) {
    const pm2 = w.stubLog('pm2').filter((l) => !l.startsWith('save'));
    assert.ok(
      pm2.length > 0 && pm2[pm2.length - 1].startsWith('startOrRestart'),
      `services started last: ${pm2}`
    );
  } else if (started === 'never-stopped') {
    assert.equal(
      w.stubLog('pm2').some((l) => l.startsWith('stop')),
      false,
      'services never stopped'
    );
  }
  if (logLine) assert.match(w.updateLog(), logLine);
}
