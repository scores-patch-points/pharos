// File primitives for the installer: atomic replace and no-follow opens. Node has no openat, so a swap of a
// parent directory for a symlink between the check and the rename is narrowed (the check is repeated right
// before the rename), not closed; the file itself is never opened through a link.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const C = fs.constants;
const NOFOLLOW = C.O_NOFOLLOW || 0;

export const tmpNameFor = (abs) => path.join(path.dirname(abs), `.${path.basename(abs).slice(0, 80)}.pharos-${crypto.randomBytes(6).toString('hex')}.tmp`);

function writeAll(fd, bytes) {
  let off = 0;
  while (off < bytes.length) off += fs.writeSync(fd, bytes, off, bytes.length - off);
}

export function fsyncDir(dir) {
  let fd;
  try { fd = fs.openSync(dir, C.O_RDONLY); fs.fsyncSync(fd); } catch { /* some filesystems refuse a directory fsync */ } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ } }
}

// write-temp, fsync, rename. The original is replaced in one step or not at all; the temp is created with
// O_EXCL|O_NOFOLLOW in the same directory (so rename is atomic) and removed on any failure.
export function atomicWrite(abs, bytes, mode = 0o644, { tmp = tmpNameFor(abs), check } = {}) {
  const fd = fs.openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | NOFOLLOW, 0o600);
  try {
    writeAll(fd, bytes);
    fs.fchmodSync(fd, mode);
    fs.fsyncSync(fd);
  } catch (err) { try { fs.closeSync(fd); } catch { /* closed */ } try { fs.unlinkSync(tmp); } catch { /* gone */ } throw err; }
  fs.closeSync(fd);
  try {
    if (check) check();
    fs.renameSync(tmp, abs); // replaces a symlink at abs rather than following it
  } catch (err) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw err; }
  fsyncDir(path.dirname(abs));
}

// append one line without following a symlink at the journal path
export function appendLine(file, line) {
  const fd = fs.openSync(file, C.O_WRONLY | C.O_APPEND | C.O_CREAT | NOFOLLOW, 0o644);
  try { writeAll(fd, Buffer.from(line)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
