// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const {execFile} = require('node:child_process');
const root = __dirname;
const types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript'};
const allowed = new Set(['index.html', 'styles.css', 'compact.css', 'compact.js', 'app.js', 'audio-engine.js', 'pitch-worklet.js', 'pitch-core.mjs']);
function createServer() {
  return http.createServer((request, response) => {
    let name;
    try { name = decodeURIComponent(request.url.split('?')[0]).slice(1) || 'index.html'; }
    catch { response.writeHead(400); response.end('Bad request'); return; }
    if (!['GET', 'HEAD'].includes(request.method) || !allowed.has(name)) {
      response.writeHead(404); response.end('Not found'); return;
    }
    response.setHeader('Content-Type', types[path.extname(name)] + '; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    if (request.method === 'HEAD') { response.end(); return; }
    fs.createReadStream(path.join(root, name)).on('error', () => { response.destroy(); }).pipe(response);
  });
}
module.exports = {createServer};
if (require.main === module) createServer().listen(4174, '127.0.0.1', () => {
  console.log('StutterSuite is running at http://127.0.0.1:4174');
  if (process.argv.includes('--open')) execFile('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:4174']);
});
