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

function translateWindowsPath(p) {
  if (!p) return p;
  // C:\... -> /mnt/c/...
  const match = p.match(/^([A-Za-z]):\\(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return p;
}

function handlePickFile(req, res) {
  const respond = payload => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const finish = (error, stdout) => {
    if (error) {
      const cancelled = error.code === 1;
      respond({ path: null, cancelled, unsupported: !cancelled });
      return;
    }
    const selectedPath = String(stdout || '').trim();
    respond({ path: selectedPath || null, cancelled: !selectedPath });
  };

  if (process.platform === 'win32' || process.env.WSL_DISTRO_NAME) {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
      '$dialog.Title = "Select WoW Combat Log"',
      '$dialog.Filter = "Combat Logs (*.txt)|*.txt|All Files (*.*)|*.*"',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }'
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { timeout: 120000 }, finish);
    return;
  }

  if (process.platform === 'darwin') {
    const script = 'POSIX path of (choose file with prompt "Select WoW Combat Log" of type {"public.plain-text"})';
    execFile('osascript', ['-e', script], { timeout: 120000 }, finish);
    return;
  }

  execFile('zenity', ['--file-selection', '--title', 'Select WoW Combat Log', '--file-filter', '*.txt'], { timeout: 120000 }, finish);
}

function handleMonitorWatch(req, res) {
  const url = new URL(req.url, `http://${HOST}:8081`);
  let filePath = url.searchParams.get('path');

  // Translate Windows paths to WSL paths
  filePath = translateWindowsPath(filePath);

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

function compactSlug(value) {
  return String(value || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

function profileLocale(region) {
  return { eu: 'en-gb', kr: 'ko-kr', tw: 'zh-tw' }[region] || 'en-us';
}

function characterProfileUrl(locale, region, realm, name) {
  return `https://worldofwarcraft.blizzard.com/${locale}/character/${region}/${encodeURIComponent(realm)}/${encodeURIComponent(name)}`;
}

async function fetchPublicPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CombatLogParser/0.2' },
    signal: AbortSignal.timeout(25000),
  });
  return { status: response.status, body: await response.text() };
}

function findCanonicalRealm(body, region, realm, name) {
  const pattern = new RegExp(`href="/character/${region}/([^/]+)/([^/]+)/?"`, 'gi');
  const requestedRealm = compactSlug(realm);
  const requestedName = compactSlug(name);
  for (const match of body.matchAll(pattern)) {
    if (compactSlug(match[1]) === requestedRealm && compactSlug(match[2]) === requestedName) return match[1];
  }
  return null;
}

function extractCharacterProfile(body) {
  const marker = 'var characterProfileInitialState = ';
  const start = body.indexOf(marker);
  if (start < 0) return null;
  const payloadStart = start + marker.length;
  const end = body.indexOf('</script>', payloadStart);
  if (end < 0) return null;
  return JSON.parse(body.slice(payloadStart, end).trim().replace(/;$/, ''));
}

async function handleCharacterProfile(url, res) {
  const region = (url.searchParams.get('region') || '').toLowerCase();
  const realm = (url.searchParams.get('realm') || '').toLowerCase();
  const name = (url.searchParams.get('name') || '').toLowerCase();
  if (!['us', 'eu', 'kr', 'tw'].includes(region) || !realm || !name) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid character identity' }));
    return;
  }

  try {
    const locale = profileLocale(region);
    let page = await fetchPublicPage(characterProfileUrl(locale, region, realm, name));
    if (page.status === 404) {
      const search = await fetchPublicPage(`https://worldofwarcraft.blizzard.com/${locale}/search/character?q=${encodeURIComponent(name)}`);
      const canonicalRealm = search.status === 200 ? findCanonicalRealm(search.body, region, realm, name) : null;
      if (canonicalRealm) page = await fetchPublicPage(characterProfileUrl(locale, region, canonicalRealm, name));
    }
    if (page.status === 404) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ found: false, retryable: false }));
      return;
    }
    if (page.status !== 200) throw new Error(`Profile provider returned ${page.status}`);
    const profile = extractCharacterProfile(page.body);
    if (!profile?.character) throw new Error('Character profile payload missing');
    const character = profile.character;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      found: true,
      provider: 'blizzard-public-profile',
      class: character.class,
      spec: character.spec,
      name: character.name,
      realm: character.realm,
    }));
  } catch (error) {
    console.warn('Character profile lookup failed:', error.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: false, retryable: true }));
  }
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
    if (url.pathname === '/api/character-profile' && req.method === 'GET') {
      void handleCharacterProfile(url, res);
      return;
    }

    // Static files
    const filePath = getSafeFilePath(url.pathname);
    if (!filePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    // Check if file exists, if not serve index.html for SPA routing
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        // Serve index.html for SPA routes (catchall)
        const indexPath = path.join(ROOT, 'index.html');
        sendFile(res, indexPath);
      } else {
        sendFile(res, filePath);
      }
    });
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
  });
}

function openBrowser(url) {
  // Browser auto-open disabled. Navigate to the URL manually.
}

startServer(START_PORT);
