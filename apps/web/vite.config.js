import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
function offlineShell() {
  return { name: 'cohort-offline-shell', generateBundle(_, bundle) {
    const assets = ['/', '/index.html', '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/push-worker.js', ...Object.keys(bundle).filter(k => /\.(js|css)$/.test(k)).map(k => '/' + k)];
    const version = createHash('sha256').update(Object.keys(bundle).join('|')).update(readFileSync(new URL('./public/push-worker.js', import.meta.url))).digest('hex').slice(0, 16);
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 'cohort-shell-' + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(assets)};
importScripts('/push-worker.js');
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('cohort-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/index.html'))); return; }
  if (ASSETS.includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});` });
  } };
}
export default defineConfig({ plugins: [react(), offlineShell()], server: { proxy: { '/api': 'http://127.0.0.1:4000' } }, build: { sourcemap: false } });
