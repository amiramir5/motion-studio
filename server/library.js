import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_PATH, RENDERS_DIR } from './config.js';

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(LIBRARY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeAll(items) {
  const tmp = LIBRARY_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, LIBRARY_PATH);
}

export function listLibrary() {
  return readAll()
    .filter((item) => item && fs.existsSync(path.join(RENDERS_DIR, item.file)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function addToLibrary(item) {
  const items = readAll();
  items.unshift(item);
  const kept = items.slice(0, 60);
  for (const old of items.slice(60)) {
    removeFiles(old);
  }
  writeAll(kept);
  return item;
}

export function getLibraryItem(id) {
  return readAll().find((item) => item.id === id) || null;
}

export function deleteFromLibrary(id) {
  const items = readAll();
  const item = items.find((entry) => entry.id === id);
  if (!item) return false;
  writeAll(items.filter((entry) => entry.id !== id));
  removeFiles(item);
  return true;
}

function removeFiles(item) {
  for (const name of [item.file, item.poster, item.source]) {
    if (!name) continue;
    try {
      fs.unlinkSync(path.join(RENDERS_DIR, name));
    } catch (e) {}
  }
}
