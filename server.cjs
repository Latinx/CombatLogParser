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

/// --- Live Monitor SSE ---
const monitors = new Map();

function handlePickFile(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  // Node.js can't open native file dialogs; returns null so client falls back to browser picker
  res.end(JSON.stringify({ path: null, cancelled: false }));
}

function handleMonitorWatch(req, res) {
  const url = new URL(req.url, `http://${HOST}:8081`);
  const filePath = url.searchParams.get('path');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing path query param' }));
    return;
  }

  let fileSize = 0;
  try {
    const stat = fs.statSync(filePath);
    fileSize = stat.size;
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found', path: filePath }));
    return;
  }

  stopMonitor(filePath);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`event: start\ndata: ${JSON.stringify({ path: filePath, fileSize })}\n\n`);

  const monitor = { res, filePath, fileSize, watcher: null, pollTimer: null };

  try {
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') checkForNewData(monitor);
    });
    monitor.watcher = watcher;
  } catch (e) {
    monitor.pollTimer = setInterval(() => checkForNewData(monitor), 2000);
  }

  monitors.set(filePath, monitor);

  req.on('close', () => stopMonitor(filePath));
}

function checkForNewData(monitor) {
  try {
    const stat = fs.statSync(monitor.filePath);
    if (stat.size <= monitor.fileSize) return;

    const newSize = stat.size;
    const readStream = fs.createReadStream(monitor.filePath, {
      start: monitor.fileSize,
      end: newSize - 1,
      encoding: 'utf-8',
    });

    let data = '';
    readStream.on('data', chunk => { data += chunk; });
    readStream.on('end', () => {
      monitor.fileSize = newSize;
      const lines = data.split('\n');
      const completeLines = data.endsWith('\n') ? lines : lines.slice(0, -1);
      if (completeLines.length > 0) {
        try {
          monitor.res.write(`event: append\ndata: ${JSON.stringify({ lines: completeLines, totalLines: monitor.fileSize })}\n\n`);
        } catch (e) {
          stopMonitor(monitor.filePath);
        }
      }
    });
    readStream.on('error', () => {});
  } catch (e) {}
}

function stopMonitor(filePath) {
  const existing = monitors.get(filePath);
  if (!existing) return;
  if (existing.watcher) existing.watcher.close();
  if (existing.pollTimer) clearInterval(existing.pollTimer);
  try { existing.res.end(); } catch (e) {}
  monitors.delete(filePath);
}

function handleMonitorStop(req, res) {
  const url = new URL(req.url, `http://${HOST}:8081`);
  const filePath = url.searchParams.get('path');
  if (filePath) stopMonitor(filePath);
  // Stop all monitors if no path specified
  if (!filePath) {
    for (const [p] of monitors) stopMonitor(p);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ stopped: true }));
}

// --- Server ---
function startServer(port) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${HOST}:${port}`);

    // API endpoints
    if (url.pathname === '/api/pick-file' && req.method === 'GET') {
      handlePickFile(req, res);
      return;
    }
    if (url.pathname === '/api/monitor/watch' && req.method === 'GET') {
      handleMonitorWatch(req, res);
      return;
    }
    if (url.pathname === '/api/monitor/stop' && req.method === 'GET') {
      handleMonitorStop(req, res);
      return;
    }

    // Static files
    const filePath = getSafeFilePath(url.pathname);
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

startServer(START_PORT);