const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');

const HOST = '127.0.0.1';
const START_PORT = Number(process.env.COMBAT_LOG_PARSER_PORT) || 8081;
const ROOT = __dirname;

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function getSafeFilePath(urlPath) {
  const decodedPath = decodeURIComponent((urlPath || '/').split('?')[0]);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(ROOT, relativePath));
  if (!filePath.startsWith(ROOT)) return null;
  return filePath;
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
      return;
    }

    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function openBrowser(url) {
  if (process.env.COMBAT_LOG_PARSER_NO_OPEN === '1') return;

  if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
    return;
  }

  if (process.platform === 'darwin') {
    execFile('open', [url]);
    return;
  }

  execFile('xdg-open', [url]);
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    const filePath = getSafeFilePath(req.url);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    sendFile(res, filePath);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      startServer(port + 1);
      return;
    }
    console.error(err);
    process.exitCode = 1;
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}`;
    console.log(`Combat Log Parser running at ${url}`);
    openBrowser(url);
  });
}

startServer(START_PORT);
