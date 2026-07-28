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

// --- Live Monitor SSE ---
// Stores active SSE response objects keyed by file path
const monitors = new Map();

function handleMonitorStart(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let filePath;
    try {
      filePath = JSON.parse(body).path;
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body. Expected {"path":"..."}' }));
      return;
    }

    if (!filePath || typeof filePath !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "path" in request body' }));
      return;
    }

    // Resolve relative to server root or absolute
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);

    // Verify file exists (or can exist)
    let fileSize = 0;
    try {
      const stat = fs.statSync(resolvedPath);
      fileSize = stat.size;
    } catch (e) {
      // File might not exist yet (WoW creates it on /log)
      fileSize = 0;
    }

    // If a monitor already exists for this path, stop it
    stopMonitor(resolvedPath);

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial state
    res.write(`event: start\ndata: ${JSON.stringify({ path: resolvedPath, fileSize })}\n\n`);

    // Track current read position
    const monitor = {
      res,
      filePath: resolvedPath,
      fileSize,
      watcher: null,
      pollTimer: null,
    };

    // Use fs.watch if available, fall back to polling
    try {
      const watcher = fs.watch(resolvedPath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          checkForNewData(monitor);
        }
      });
      monitor.watcher = watcher;
    } catch (e) {
      // fs.watch not available (network drive, WSL cross-fs issues, etc.)
      // Fall back to polling every 2 seconds
      monitor.pollTimer = setInterval(() => checkForNewData(monitor), 2000);
    }

    monitors.set(resolvedPath, monitor);

    // Clean up on disconnect
    req.on('close', () => {
      stopMonitor(resolvedPath);
    });
  });
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
      // Split into lines, send each as SSE data
      const lines = data.split('\n');
      // The last line might be incomplete (still being written) — track it
      const completeLines = data.endsWith('\n') ? lines : lines.slice(0, -1);
      if (completeLines.length > 0) {
        try {
          monitor.res.write(`event: append\ndata: ${JSON.stringify({ lines: completeLines, totalLines: monitor.fileSize })}\n\n`);
        } catch (e) {
          // Client disconnected
          stopMonitor(monitor.filePath);
        }
      }
    });
    readStream.on('error', () => {});
  } catch (e) {
    // File may be temporarily inaccessible
  }
}

function stopMonitor(filePath) {
  const existing = monitors.get(filePath);
  if (!existing) return;
  if (existing.watcher) {
    existing.watcher.close();
  }
  if (existing.pollTimer) {
    clearInterval(existing.pollTimer);
  }
  try { existing.res.end(); } catch (e) {}
  monitors.delete(filePath);
}

function handleMonitorStop(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let filePath;
    try {
      filePath = JSON.parse(body).path;
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    stopMonitor(filePath);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stopped: true }));
  });
}

// --- Server ---
function startServer(port) {
  const server = http.createServer((req, res) => {
    // CORS for SSE
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
    if (url.pathname === '/api/monitor/start' && req.method === 'POST') {
      handleMonitorStart(req, res);
      return;
    }
    if (url.pathname === '/api/monitor/stop' && req.method === 'POST') {
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