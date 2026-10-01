import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mongoVersion, resolveDemoMongo } from '../demo-mongo.mjs';
const win = path.win32;
const executable = (root, version) => win.join(root, 'MongoDB', 'Server', version, 'bin', 'mongod.exe');
function machine({ files = {}, directories = {} } = {}) {
  const probed = [];
  return {
    probed,
    info: async file => { if (!files[file]) throw new Error('ENOENT'); return { isFile: () => files[file] !== 'directory' }; },
    list: async dir => { if (!directories[dir]) throw new Error('ENOENT'); return directories[dir].map(name => ({ name, isDirectory: () => true })); },
    probe: async file => { probed.push(file); if (files[file] === 'broken') throw new Error('bad executable'); return files[file]; },
  };
}
test('Windows auto-detects standard installation and uses actual 8.3.11 instead of pinned 7.0.24', async () => {
  const file = executable('C:\\Program Files', '8.3');
  const deps = machine({ files: { [file]: '8.3.11' }, directories: { 'C:\\Program Files\\MongoDB\\Server': ['8.3'] } });
  const result = await resolveDemoMongo({ platform: 'win32', env: {}, ...deps });
  assert.deepEqual(result.binary, { systemBinary: file, version: '8.3.11' });
  assert.ok(result.description.includes(file));
});
test('Windows searches version folders numerically and skips broken/old installations', async () => {
  const root = 'C:\\Program Files'; const deps = machine({
    files: { [executable(root, '8.10')]: 'broken', [executable(root, '8.9')]: '8.9.1', [executable(root, '8.2')]: '8.2.0' },
    directories: { [win.join(root, 'MongoDB', 'Server')]: ['8.2', '8.9', '8.10', 'notes'] },
  });
  const result = await resolveDemoMongo({ platform: 'win32', env: {}, ...deps });
  assert.equal(result.binary.version, '8.9.1');
  assert.deepEqual(deps.probed, [executable(root, '8.10'), executable(root, '8.9')]);
});
test('Windows PATH is case-insensitive, supports quoted folders with spaces, and takes precedence', async () => {
  const file = 'D:\\MongoDB Server\\bin\\mongod.exe'; const deps = machine({ files: { [file]: '8.3.11' } });
  const result = await resolveDemoMongo({ platform: 'win32', env: { Path: ';"D:\\MongoDB Server\\bin";C:\\Other' }, ...deps });
  assert.equal(result.binary.systemBinary, file);
});
test('explicit persistent path wins and its version is probed despite an old MONGOMS_VERSION', async () => {
  const file = 'D:\\Custom Mongo\\bin\\mongod.exe'; const deps = machine({ files: { [file]: '8.3.11' } });
  const result = await resolveDemoMongo({ platform: 'win32', env: { MONGOMS_SYSTEM_BINARY: 'D:/Custom Mongo/bin/mongod.exe', MONGOMS_VERSION: '7.0.24' }, ...deps });
  assert.deepEqual(result.binary, { systemBinary: file, version: '8.3.11' });
});
test('bad explicit path fails rather than falling back to another executable or download', async () => {
  const deps = machine();
  await assert.rejects(resolveDemoMongo({ platform: 'win32', env: { MONGOMS_SYSTEM_BINARY: 'D:/missing/mongod.exe' }, ...deps }), /No download was attempted/);
  assert.equal(deps.probed.length, 0);
});
test('custom Program Files root is detected and MongoDB older than 7 is skipped', async () => {
  const root = 'D:\\Apps'; const old = 'D:\\Old Mongo\\mongod.exe'; const file = executable(root, '7.0');
  const deps = machine({ files: { [old]: '6.0.0', [file]: '7.0.24' }, directories: { [win.join(root, 'MongoDB', 'Server')]: ['7.0'] } });
  const result = await resolveDemoMongo({ platform: 'win32', env: { PATH: 'D:\\Old Mongo', PROGRAMFILES: root }, ...deps });
  assert.equal(result.binary.systemBinary, file);
});
test('absence of Windows installations preserves download/cache configuration without probing other programs', async () => {
  const deps = machine(); const result = await resolveDemoMongo({ platform: 'win32', env: { MONGOMS_VERSION: '7.0.25' }, ...deps });
  assert.deepEqual(result.binary, { version: '7.0.25' }); assert.deepEqual(deps.probed, []);
});
test('Linux uses pinned download/cache unless an executable was explicitly configured', async () => {
  const deps = machine({ files: { '/custom/mongod': '8.0.1' } });
  assert.deepEqual((await resolveDemoMongo({ platform: 'linux', env: {}, ...deps })).binary, { version: '7.0.24' });
  assert.deepEqual((await resolveDemoMongo({ platform: 'linux', env: { MONGOMS_SYSTEM_BINARY: '/custom/mongod' }, ...deps })).binary, { systemBinary: '/custom/mongod', version: '8.0.1' });
});
test('disabled runtime downloads still allow memory-server to find an existing cached binary', async () => {
  const result = await resolveDemoMongo({ platform: 'win32', env: { MONGOMS_RUNTIME_DOWNLOAD: 'false' }, ...machine() });
  assert.deepEqual(result.binary, { version: '7.0.24' });
});
test('real executable probe rejects a non-MongoDB executable', async () => {
  await assert.rejects(mongoVersion(process.execPath), /MongoDB server version/);
});
