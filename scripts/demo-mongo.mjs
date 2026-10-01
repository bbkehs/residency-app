import { readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const execute = promisify(execFile);
const value = (env, name) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const unquote = text => text.trim().replace(/^"(.*)"$/, '$1');

export async function mongoVersion(executable) {
  const { stdout } = await execute(executable, ['--version'], { timeout: 10000, windowsHide: true, maxBuffer: 65536 });
  const version = stdout.match(/\bdb version v?(\d+\.\d+\.\d+)/i)?.[1];
  if (!version) throw new Error('The executable did not report a MongoDB server version.');
  return version;
}

// Choose an executable only. MongoMemoryReplSet still creates its own temporary
// database and random port; no installed MongoDB service or existing data is used.
export async function resolveDemoMongo({ env = process.env, platform = process.platform, list = readdir, info = stat, probe = mongoVersion } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  async function installed(executable) {
    if (!(await info(executable)).isFile()) throw new Error('Not a file');
    const version = await probe(executable);
    if (!/^\d+\.\d+\.\d+$/.test(version) || Number(version.split('.')[0]) < 7) throw new Error('The demo needs MongoDB 7 or newer.');
    return { binary: { systemBinary: executable, version }, description: `Using installed MongoDB ${version}: ${executable}` };
  }
  const explicit = value(env, 'MONGOMS_SYSTEM_BINARY');
  if (explicit?.trim()) {
    const executable = paths.resolve(unquote(explicit));
    try { return await installed(executable); }
    catch { throw new Error(`Cannot use MONGOMS_SYSTEM_BINARY: ${executable}. Check that it points to a working mongod executable (MongoDB 7 or newer). No download was attempted.`); }
  }
  if (platform === 'win32') {
    const candidates = (value(env, 'PATH') || '').split(';').map(unquote).filter(Boolean).map(dir => paths.resolve(dir, 'mongod.exe'));
    const roots = new Set([value(env, 'ProgramW6432'), value(env, 'ProgramFiles'), 'C:\\Program Files'].filter(Boolean));
    for (const root of roots) {
      const server = paths.join(root, 'MongoDB', 'Server');
      let versions; try { versions = await list(server, { withFileTypes: true }); } catch { continue; }
      const folders = versions.filter(entry => entry.isDirectory() && /^\d+(?:\.\d+)*$/.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
      for (const folder of folders) candidates.push(paths.join(server, folder.name, 'bin', 'mongod.exe'));
    }
    for (const executable of new Set(candidates)) {
      try { return await installed(executable); } catch { /* Skip unusable or older installations. */ }
    }
  }
  const version = value(env, 'MONGOMS_VERSION') || '7.0.24';
  return { binary: { version }, description: `No installed MongoDB selected; using the cached/downloaded MongoDB ${version}. For a custom installation, set MONGOMS_SYSTEM_BINARY in .env.` };
}
