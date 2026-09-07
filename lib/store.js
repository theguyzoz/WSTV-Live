import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

// tiny json store. each collection is one file, written atomically
const FILES = {
  users: 'users.json',
  sessions: 'sessions.json',
  channels: 'channels.json',
  chat: 'chat.json',
};

const cache = {};

function load(name) {
  if (cache[name]) return cache[name];
  const fp = path.join(DATA_DIR, FILES[name]);
  let data = null;
  try { data = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
  if (!data) {
    if (name === 'users') data = { users: [] };
    else if (name === 'sessions') data = { sessions: {} };
    else if (name === 'channels') data = { channels: [] };
    else if (name === 'chat') data = { messages: {} };
  }
  cache[name] = data;
  return data;
}

export function save(name) {
  const data = load(name);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const fp = path.join(DATA_DIR, FILES[name]);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fp);
}

export const db = {
  get users() { return load('users').users; },
  set users(v) { load('users').users = v; save('users'); },
  get sessions() { return load('sessions').sessions; },
  get channels() { return load('channels').channels; },
  set channels(v) { load('channels').channels = v; save('channels'); },
  get chat() { return load('chat').messages; },
};

export function saveUsers() { save('users'); }
export function saveSessions() { save('sessions'); }
export function saveChannels() { save('channels'); }
export function saveChat() { save('chat'); }

export function findUserByName(username) {
  const u = String(username || '').toLowerCase().trim();
  return db.users.find(x => x.usernameLower === u) || null;
}
export function findUserById(id) {
  return db.users.find(x => x.id === id) || null;
}
