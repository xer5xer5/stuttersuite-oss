const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = __dirname;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

http.createServer((request, response) => {
  const rawPath = request.url === '/' ? '/index.html' : request.url;
  const filePath = path.resolve(root, `.${decodeURIComponent(rawPath.split('?')[0])}`);

  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
}).listen(4174, '127.0.0.1', () => {
  console.log('StutterSuite is running at http://127.0.0.1:4174');
  if (process.argv.includes('--open')) {
    execFile('cmd.exe', ['/c', 'start', '', 'http://127.0.0.1:4174']);
  }
});
