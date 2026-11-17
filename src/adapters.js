// Talk to an adapter process (see adapters/PROTOCOL.md).
//
// One request is outstanding at a time. A library that does not answer within
// the time limit is killed and restarted, and the request is recorded as a
// hang; a library that takes the process down is recorded as a crash.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The parsers under test (`key` "adapters") or the patch appliers (`key` "appliers"). */
export function loadRegistry(path = join(ROOT, 'adapters', 'registry.json'), key = 'adapters') {
  const reg = JSON.parse(readFileSync(path, 'utf8'));
  return (reg[key] ?? []).map((a) => ({ ...a, cwd: join(dirname(path), a.cwd ?? '.') }));
}

/**
 * Call `onLine` with every line of a stream. A line ends with LF and with
 * nothing else. node:readline is not used for this: it also ends a line at a
 * lone CR and, from Node.js 24, at U+2028 and U+2029, which may stand unescaped
 * inside a JSON string (JSON.stringify writes them that way). Complete lines
 * are decoded, never chunks, so a character split across two chunks is safe.
 */
export function onLines(stream, onLine) {
  let pending = [];
  stream.on('data', (chunk) => {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(10, start);
      if (nl === -1) break;
      pending.push(chunk.subarray(start, nl));
      const line = Buffer.concat(pending).toString('utf8');
      pending = [];
      start = nl + 1;
      onLine(line);
    }
    if (start < chunk.length) pending.push(chunk.subarray(start));
  });
}

/** JSON on one line in plain ASCII, so that no reader can split it anywhere else. */
export function jsonLine(value) {
  const json = JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return `${json}\n`;
}

export class AdapterProcess {
  constructor(spec, { timeoutMs = 10000 } = {}) {
    this.spec = spec;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.hello = null;
    this.waiting = null; // { resolve, timer }
    this.stderr = '';
    this.restarts = 0;
  }

  async start() {
    const [cmd, ...args] = this.spec.cmd;
    this.child = spawn(cmd, args, { cwd: this.spec.cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...(this.spec.env ?? {}) } });
    const child = this.child;
    this.stderr = '';
    child.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d.toString('utf8')).slice(-4000);
    });
    child.stdin.on('error', () => {}); // EPIPE when the child died; handled through 'exit'
    onLines(child.stdout, (line) => {
      if (child !== this.child || !this.waiting) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return; // stray output from the library; ignore
      }
      const w = this.waiting;
      this.waiting = null;
      clearTimeout(w.timer);
      w.resolve(msg);
    });
    child.on('exit', (code, signal) => {
      if (child !== this.child) return;
      this.child = null;
      if (this.waiting) {
        const w = this.waiting;
        this.waiting = null;
        clearTimeout(w.timer);
        w.resolve({ ok: false, died: true, error: `adapter process exited (${signal ?? code}): ${this.stderr.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}` });
      }
    });
    const hello = await this.#await(30000);
    if (!hello || !hello.hello) throw new Error(`adapter ${this.spec.name} did not say hello: ${JSON.stringify(hello)} ${this.stderr}`);
    this.hello ??= hello;
    return hello;
  }

  #await(timeoutMs) {
    return new Promise((res) => {
      const timer = setTimeout(() => {
        if (!this.waiting) return;
        this.waiting = null;
        const child = this.child;
        this.child = null;
        if (child) child.kill('SIGKILL');
        res({ hang: true });
      }, timeoutMs);
      this.waiting = { resolve: res, timer };
    });
  }

  /** Send one request and wait for its answer. `extra` carries the fields of the apply operations. */
  async request(id, path, extra = {}) {
    if (!this.child) {
      this.restarts++;
      await this.start();
    }
    const p = this.#await(this.timeoutMs);
    this.child.stdin.write(jsonLine({ id, path, ...extra }));
    return p;
  }

  async stop() {
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      child.kill();
    }
  }
}

export { ROOT };
