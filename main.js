const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

function initDb() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'libometer.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS courses(id INTEGER PRIMARY KEY, playlist_id TEXT UNIQUE, title TEXT, channel TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS videos(id INTEGER PRIMARY KEY, course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      yt_id TEXT, title TEXT, duration INTEGER, position INTEGER, watched INTEGER DEFAULT 0, completed INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS notes(id INTEGER PRIMARY KEY, video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
      ts INTEGER, text TEXT, kind TEXT, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS study(day TEXT PRIMARY KEY, seconds INTEGER);
    CREATE TABLE IF NOT EXISTS course_groups(id INTEGER PRIMARY KEY, name TEXT UNIQUE, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
  `);
  for (const sql of ['ALTER TABLE courses ADD COLUMN group_id INTEGER', 'ALTER TABLE videos ADD COLUMN orig_pos INTEGER', 'ALTER TABLE courses ADD COLUMN custom INTEGER DEFAULT 0']) { try { db.exec(sql); } catch {} } // upgrade older databases
  db.exec('UPDATE videos SET orig_pos=position WHERE orig_pos IS NULL');
}

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '';

const iso = (s) => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

async function yt(endpoint, params) {
  const key = getSetting('api_key');
  if (!key) throw new Error('Add your YouTube API key in Settings first.');
  const url = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  Object.entries({ ...params, key }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'YouTube API request failed.');
  return json;
}

async function importPlaylist(input, groupId) {
  const text = String(input).trim();
  const id = (text.match(/[?&]list=([\w-]+)/) || [])[1] || (/^[\w-]{13,}$/.test(text) ? text : null);
  if (!id) throw new Error('No playlist ID found. Paste a link that contains "list=".');
  if (db.prepare('SELECT 1 FROM courses WHERE playlist_id=?').get(id)) throw new Error('This playlist is already in your library.');

  const pl = (await yt('playlists', { part: 'snippet', id })).items?.[0];
  if (!pl) throw new Error('Playlist not found. Private playlists cannot be imported.');

  let items = [], pageToken = '';
  do {
    const j = await yt('playlistItems', { part: 'snippet', playlistId: id, maxResults: 50, ...(pageToken && { pageToken }) });
    items.push(...j.items);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  items = items.filter((i) => !['Private video', 'Deleted video'].includes(i.snippet.title));

  const dur = {};
  for (let i = 0; i < items.length; i += 50) {
    const ids = items.slice(i, i + 50).map((x) => x.snippet.resourceId.videoId).join(',');
    (await yt('videos', { part: 'contentDetails', id: ids })).items.forEach((v) => (dur[v.id] = iso(v.contentDetails.duration)));
  }

  return db.transaction(() => {
    const cid = db.prepare('INSERT INTO courses(playlist_id,title,channel,created_at,group_id) VALUES(?,?,?,?,?)')
      .run(id, pl.snippet.title, pl.snippet.channelTitle, Date.now(), groupId || null).lastInsertRowid;
    const ins = db.prepare('INSERT INTO videos(course_id,yt_id,title,duration,position,orig_pos) VALUES(?,?,?,?,?,?)');
    items.forEach((it, n) => ins.run(cid, it.snippet.resourceId.videoId, it.snippet.title, dur[it.snippet.resourceId.videoId] || 0, n, n));
    return cid;
  })();
}

function stats() {
  const v = db.prepare('SELECT COUNT(*) total, COALESCE(SUM(completed),0) done FROM videos').get();
  const days = db.prepare('SELECT day, seconds FROM study WHERE seconds>0 ORDER BY day DESC').all();
  const seconds = days.reduce((a, d) => a + d.seconds, 0);
  const set = new Set(days.map((d) => d.day));
  let streak = 0;
  const d = new Date();
  if (!set.has(d.toLocaleDateString('en-CA'))) d.setDate(d.getDate() - 1); // today may not have started yet
  while (set.has(d.toLocaleDateString('en-CA'))) { streak++; d.setDate(d.getDate() - 1); }
  const notes = db.prepare('SELECT COUNT(*) n FROM notes WHERE kind=?').get('note').n;
  return { total: v.total, done: v.done, seconds, streak, notes };
}

const handle = (name, fn) => ipcMain.handle(name, (_e, ...args) => fn(...args));

function registerIpc() {
  handle('settings:get', getSetting);
  handle('settings:set', (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, v));
  handle('courses:list', () => db.prepare(`
    SELECT c.*, (SELECT yt_id FROM videos WHERE course_id=c.id ORDER BY position LIMIT 1) first_vid, COUNT(v.id) total, COALESCE(SUM(v.completed),0) done, COALESCE(SUM(v.duration),0) duration
    FROM courses c LEFT JOIN videos v ON v.course_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`).all());
  handle('courses:import', importPlaylist);
  const vid = (s) => (String(s).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || String(s).trim().match(/^([\w-]{11})$/) || [])[1];
  handle('courses:createCustom', (title, gid) => Number(db.prepare('INSERT INTO courses(playlist_id,title,channel,created_at,group_id,custom) VALUES(?,?,?,?,?,1)').run('custom-' + Date.now(), title, 'Custom playlist', Date.now(), gid || null).lastInsertRowid));
  handle('videos:addLinks', async (cid, text) => {
    const tokens = String(text).split(/\s+/).filter(Boolean);
    const ids = [...new Set(tokens.map(vid).filter(Boolean))];
    const info = {};
    for (let i = 0; i < ids.length; i += 50) {
      const j = await yt('videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(',') });
      j.items.forEach((v) => (info[v.id] = { title: v.snippet.title, dur: iso(v.contentDetails.duration) }));
    }
    let pos = db.prepare('SELECT COALESCE(MAX(position),-1)+1 p FROM videos WHERE course_id=?').get(cid).p;
    const ins = db.prepare('INSERT INTO videos(course_id,yt_id,title,duration,position,orig_pos) VALUES(?,?,?,?,?,?)');
    let added = 0;
    db.transaction(() => ids.forEach((id) => { if (info[id]) { ins.run(cid, id, info[id].title, info[id].dur, pos, pos); pos++; added++; } }))();
    return { added, skipped: tokens.length - added };
  });
  handle('videos:reorder', (cid, ids) => db.transaction(() => { const u = db.prepare('UPDATE videos SET position=? WHERE id=? AND course_id=?'); ids.forEach((id, i) => u.run(i, id, cid)); })());
  handle('videos:resetOrder', (cid) => db.prepare('UPDATE videos SET position=orig_pos WHERE course_id=?').run(cid));
  handle('videos:delete', (id) => db.prepare('DELETE FROM videos WHERE id=?').run(id));
  handle('courses:setGroup', (cid, gid) => db.prepare('UPDATE courses SET group_id=? WHERE id=?').run(gid, cid));
  handle('groups:list', () => db.prepare('SELECT g.*, COUNT(c.id) n FROM course_groups g LEFT JOIN courses c ON c.group_id=g.id GROUP BY g.id ORDER BY g.name').all());
  handle('groups:add', (name) => Number(db.prepare('INSERT INTO course_groups(name,created_at) VALUES(?,?)').run(name, Date.now()).lastInsertRowid));
  handle('groups:delete', (id) => db.transaction(() => {
    db.prepare('UPDATE courses SET group_id=NULL WHERE group_id=?').run(id);
    db.prepare('DELETE FROM course_groups WHERE id=?').run(id);
  })());
  handle('courses:delete', (id) => db.prepare('DELETE FROM courses WHERE id=?').run(id));
  handle('videos:list', (cid) => db.prepare('SELECT * FROM videos WHERE course_id=? ORDER BY position').all(cid));
  handle('videos:progress', (id, watched, done) => db.prepare('UPDATE videos SET watched=?, completed=MAX(completed,?) WHERE id=?').run(watched, done ? 1 : 0, id));
  handle('videos:toggle', (id) => db.prepare('UPDATE videos SET completed=1-completed WHERE id=?').run(id));
  handle('notes:list', (vid) => db.prepare('SELECT * FROM notes WHERE video_id=? ORDER BY ts, id').all(vid));
  handle('notes:add', (vid, ts, text, kind) => db.prepare('INSERT INTO notes(video_id,ts,text,kind,created_at) VALUES(?,?,?,?,?)').run(vid, ts, text, kind, Date.now()));
  handle('notes:delete', (id) => db.prepare('DELETE FROM notes WHERE id=?').run(id));
  handle('stats:get', stats);
  handle('stats:addTime', (sec) => db.prepare('INSERT INTO study(day,seconds) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET seconds=seconds+excluded.seconds').run(today(), sec));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 960, minHeight: 600, backgroundColor: '#000000', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, 'dist/index.html'));
}

app.whenReady().then(() => {
  initDb();
  registerIpc();
  // Packaged apps load from file://, which YouTube's player rejects without a referrer.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'] },
    (d, cb) => { d.requestHeaders['Referer'] = 'https://localhost/'; cb({ requestHeaders: d.requestHeaders }); }
  );
  createWindow();
});
app.on('window-all-closed', () => app.quit());
