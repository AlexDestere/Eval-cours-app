import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDir, fileExists, readJson, removeFile, writeJson } from './lib/fs-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const YEARS_DIR = path.join(DATA_DIR, 'years');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const YEARS_FILE = path.join(DATA_DIR, 'years.json');
const PORT = Number(process.env.PORT || 8787);

ensureDir(DATA_DIR);
ensureDir(YEARS_DIR);

const json = (res, status, payload) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(payload));
};

const text = (res, status, payload, type = 'text/plain; charset=utf-8') => {
  res.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
  });
  res.end(payload);
};

const parseBodyJson = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('invalid_json');
    error.status = 400;
    throw error;
  }
};

const safeYearId = (yearId) => String(yearId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
const yearFile = (yearId) => path.join(YEARS_DIR, `${safeYearId(yearId)}.json`);

const countResponses = (responses = {}) =>
  Object.values(responses).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);

const normalizeYearData = (value) => ({
  ues: Array.isArray(value?.ues) ? value.ues : [],
  responses:
    value?.responses && typeof value.responses === 'object' && !Array.isArray(value.responses)
      ? value.responses
      : {},
});

const readYearData = (yearId) => {
  const file = yearFile(yearId);
  const exists = fileExists(file);
  const data = normalizeYearData(readJson(file, null));
  return { exists, ...data };
};

const writeYearData = (yearId, value) => {
  const file = yearFile(yearId);
  const next = normalizeYearData(value);
  writeJson(file, next);
  return next;
};

const readYears = () => {
  const years = readJson(YEARS_FILE, null);
  return Array.isArray(years) ? years : [];
};

const responseCountsByYear = () =>
  Object.fromEntries(readYears().map((year) => [year.id, countResponses(readYearData(year.id).responses)]));

const serveStatic = (req, res, pathname) => {
  if (!fileExists(DIST_DIR)) return false;

  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const resolved = path.normalize(path.join(DIST_DIR, requested));
  if (!resolved.startsWith(DIST_DIR)) {
    text(res, 403, 'forbidden');
    return true;
  }

  let file = resolved;
  if (!fileExists(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST_DIR, 'index.html');
  }
  if (!fileExists(file)) return false;

  const ext = path.extname(file).toLowerCase();
  const mime =
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.ico': 'image/x-icon',
    }[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'content-type': mime,
    'access-control-allow-origin': '*',
  });
  fs.createReadStream(file).pipe(res);
  return true;
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      json(res, 200, { ok: true, now: new Date().toISOString() });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/eval/bootstrap') {
      json(res, 200, {
        hasConfig: fileExists(CONFIG_FILE),
        hasYears: fileExists(YEARS_FILE),
        config: readJson(CONFIG_FILE, null),
        years: readJson(YEARS_FILE, null),
        responseCounts: responseCountsByYear(),
      });
      return;
    }

    if (req.method === 'PUT' && pathname === '/api/eval/config') {
      const body = await parseBodyJson(req);
      writeJson(CONFIG_FILE, body.config ?? null);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === 'PUT' && pathname === '/api/eval/years') {
      const body = await parseBodyJson(req);
      if (!Array.isArray(body.years)) {
        json(res, 400, { error: 'invalid_years' });
        return;
      }

      const previousIds = new Set(readYears().map((year) => year.id));
      const nextIds = new Set(body.years.map((year) => year.id));
      writeJson(YEARS_FILE, body.years);

      for (const yearId of previousIds) {
        if (!nextIds.has(yearId)) removeFile(yearFile(yearId));
      }

      json(res, 200, {
        ok: true,
        responseCounts: responseCountsByYear(),
      });
      return;
    }

    const yearMatch = pathname.match(/^\/api\/eval\/years\/([^/]+)$/);
    if (req.method === 'GET' && yearMatch) {
      const yearId = decodeURIComponent(yearMatch[1]);
      const data = readYearData(yearId);
      json(res, 200, { yearId, ...data });
      return;
    }

    if (req.method === 'PUT' && yearMatch) {
      const yearId = decodeURIComponent(yearMatch[1]);
      const body = await parseBodyJson(req);
      const current = readYearData(yearId);
      const next = writeYearData(yearId, {
        ues: body.ues ?? current.ues,
        responses: body.responses ?? current.responses,
      });
      json(res, 200, { ok: true, yearId, ...next });
      return;
    }

    const yearUesMatch = pathname.match(/^\/api\/eval\/years\/([^/]+)\/ues$/);
    if (req.method === 'PUT' && yearUesMatch) {
      const yearId = decodeURIComponent(yearUesMatch[1]);
      const body = await parseBodyJson(req);
      if (!Array.isArray(body.ues)) {
        json(res, 400, { error: 'invalid_ues' });
        return;
      }
      const current = readYearData(yearId);
      writeYearData(yearId, { ...current, ues: body.ues });
      json(res, 200, { ok: true });
      return;
    }

    const yearResponsesMatch = pathname.match(/^\/api\/eval\/years\/([^/]+)\/responses$/);
    if (yearResponsesMatch && req.method === 'PUT') {
      const yearId = decodeURIComponent(yearResponsesMatch[1]);
      const body = await parseBodyJson(req);
      if (!body.responses || typeof body.responses !== 'object' || Array.isArray(body.responses)) {
        json(res, 400, { error: 'invalid_responses' });
        return;
      }
      const current = readYearData(yearId);
      writeYearData(yearId, { ...current, responses: body.responses });
      json(res, 200, { ok: true });
      return;
    }

    if (yearResponsesMatch && req.method === 'POST') {
      const yearId = decodeURIComponent(yearResponsesMatch[1]);
      const body = await parseBodyJson(req);
      const ueId = String(body.ueId || '').trim();
      const courseName = String(body.courseName || '').trim();
      const response = body.response && typeof body.response === 'object' ? body.response : null;
      if (!ueId || !courseName || !response) {
        json(res, 400, { error: 'missing_fields', required: ['ueId', 'courseName', 'response'] });
        return;
      }
      const current = readYearData(yearId);
      const key = `${ueId}::${courseName}`;
      const nextResponses = {
        ...current.responses,
        [key]: [...(current.responses[key] || []), response],
      };
      writeYearData(yearId, { ...current, responses: nextResponses });
      json(res, 200, {
        ok: true,
        yearId,
        key,
        total: nextResponses[key].length,
      });
      return;
    }

    if (pathname.startsWith('/api/')) {
      json(res, 404, { error: 'not_found' });
      return;
    }

    if (serveStatic(req, res, pathname)) return;
    text(res, 404, 'not_found');
  } catch (error) {
    json(res, error.status || 500, { error: error.message || 'internal_error' });
  }
});

server.listen(PORT, () => {
  console.log(`Eval server listening on http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
