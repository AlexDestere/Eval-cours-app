import fs from 'node:fs';
import path from 'node:path';

export const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

export const fileExists = (file) => {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
};

export const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

export const writeJson = (file, value) => {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
};

export const removeFile = (file) => {
  try {
    fs.unlinkSync(file);
  } catch {}
};
