import React, { useEffect, useRef, useState, useCallback } from 'react';
import me from './assets/umang.jpg';

const call = (c, ...a) => window.api.invoke(c, ...a);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (s) => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? `${h}:${pad(m)}` : `${m}`) + `:${pad(s % 60)}`; };
const hours = (s) => (s / 3600).toFixed(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clean = (m) => m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const THEMES = [['eyecare', 'Eye-care Black', '#000000'], ['midnight', 'Midnight', '#0a1020'], ['paper', 'Paper', '#f6f4ef'], ['sepia', 'Sepia', '#f1e7d0'], ['forest', 'Forest', '#13241d'], ['plum', 'Plum', '#1e1630'], ['slate', 'Slate', '#232b34']];

let ytReady;
const loadYT = () => (ytReady ||= new Promise((res) => {
  if (window.YT?.Player) return res();
  window.onYouTubeIframeAPIReady = res;
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
}));

function useConfirm() {
  const [st, setSt] = useState(null);
  const ask = (message, yes = 'Delete') => new Promise((res) => setSt({ message, yes, res }));
  const close = (v) => { st.res(v); setSt(null); };
  const dialog = st && (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm" onKeyDown={(e) => e.key === 'Escape' && close(false)}>
      <div className="mbox">
        <p>{st.message}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="ghost" autoFocus onClick={() => close(false)}>Cancel</button>
          <button onClick={() => close(true)}>{st.yes}</button>
        </div>
      </div>
    </div>
  );
  return [ask, dialog];
}

export default function App() {
  const [route, setRoute] = useState({ v: 'home' });
  const [theme, setTheme] = useState('eyecare');
  useEffect(() => { call('settings:get', 'theme').then((t) => t && setTheme(t)); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const pick = (t) => { setTheme(t); call('settings:set', 'theme', t); };
  const home = () => setRoute({ v: 'home' });
  if (route.v === 'course') return <Course id={route.id} onBack={home} />;
  if (route.v === 'about') return <About onBack={home} />;
  return <Home theme={theme} onTheme={pick} onOpen={(id) => setRoute({ v: 'course', id })} onAbout={() => setRoute({ v: 'about' })} />;
}

function About({ onBack }) {
  const ext = { target: '_blank', rel: 'noopener noreferrer' };
  return (
    <div className="about">
      <button className="ghost" onClick={onBack}>Back to library</button>
      <div className="ab">
        <img src={me} alt="Illustration of Umang Bhatt at his desk with a laptop and a Hulk figurine" />
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1>Umang Bhatt</h1>
          <p>BS student at IIT Madras, studying Data Science and Applications. I love statistics, mathematics, and the Hulk.</p>
          <h3>Why I built LiboMeter</h3>
          <p>I built LiboMeter for students, music lovers, documentary lovers and movie lovers who struggle to keep their YouTube playlists in order. Sort your playlists into groups, import them, and find them again easily. You can also shuffle, move videos up and down a playlist, bookmark moments, and take notes.</p>
          <blockquote>Life isn't worth complicating. It's better to be useful and do your karma.</blockquote>
          <p><a href="https://www.linkedin.com/in/bhattumangk/" {...ext}>LinkedIn</a> · <a href="https://github.com/umangkbhatt" {...ext}>GitHub</a> · <a href="https://github.com/umangkbhatt/libometer/issues" {...ext}>Report an issue</a></p>
          <p className="dim">LiboMeter v0.1.0 · MIT license · Independent software, not affiliated with YouTube or Google.</p>
        </div>
      </div>
    </div>
  );
}

function Home({ theme, onTheme, onOpen, onAbout }) {
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({});
  const [active, setActive] = useState('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState('grid');
  const [sort, setSort] = useState('new');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('');
  const [panel, setPanel] = useState('');
  const [newGroup, setNewGroup] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ask, dialog] = useConfirm();

  const load = useCallback(async () => {
    setCourses(await call('courses:list')); setGroups(await call('groups:list')); setStats(await call('stats:get'));
  }, []);
  useEffect(() => {
    load();
    call('settings:get', 'api_key').then((k) => { setKey(k); if (!k) setPanel('key'); });
    call('settings:get', 'view').then((v) => v && setView(v));
  }, [load]);

  const inGroup = typeof active === 'number' ? groups.find((g) => g.id === active) : null;
  const sorters = { new: (a, b) => b.created_at - a.created_at, az: (a, b) => a.title.localeCompare(b.title), progress: (a, b) => b.done / (b.total || 1) - a.done / (a.total || 1) };
  const shown = courses.filter((c) => (active === 'all' || (active === 'none' ? !c.group_id : c.group_id === active)) && c.title.toLowerCase().includes(q.toLowerCase())).sort(sorters[sort]);

  const run = async (fn) => { setErr(''); try { await fn(); } catch (ex) { const m = clean(ex.message); setErr(/UNIQUE/.test(m) ? 'A group with that name already exists.' : m); } };
  const importIt = (e) => { e.preventDefault(); setBusy(true); run(async () => { await call('courses:import', url, inGroup ? inGroup.id : null); setUrl(''); setPanel(''); await load(); }).finally(() => setBusy(false)); };
  const createCustom = (e) => { e.preventDefault(); run(async () => onOpen(await call('courses:createCustom', title.trim(), inGroup ? inGroup.id : null))); };
  const addGroup = (e) => { e.preventDefault(); const n = newGroup.trim(); if (n) run(async () => { const id = await call('groups:add', n); setNewGroup(null); await load(); setActive(id); }); };
  const delGroup = async () => { if (await ask(`Delete the group "${inGroup.name}"? Its playlists stay in your library.`)) run(async () => { await call('groups:delete', inGroup.id); setActive('all'); await load(); }); };
  const saveKey = async () => { await call('settings:set', 'api_key', key.trim()); setPanel(''); };
  const setV = (v) => { setView(v); call('settings:set', 'view', v); };
  const chip = (on) => 'chip' + (on ? ' on' : '');
  const toggle = (p) => setPanel(panel === p ? '' : p);

  const card = (c) => (
    <article className="card" key={c.id}>
      <div className="thumb" onClick={() => onOpen(c.id)}>
        {c.first_vid ? <img src={`https://i.ytimg.com/vi/${c.first_vid}/hqdefault.jpg`} alt="" /> : <div className="ph">No videos yet</div>}
        <span className="badge">{plural(c.total, 'video')}</span>
      </div>
      <div className="body">
        <h3 title={c.title}>{c.title}</h3>
        <div className="meta">Added {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}{c.custom ? ' · Custom' : ''}</div>
        <div className="prow"><span>Progress</span><b>{c.done}/{c.total} completed</b></div>
        <div className="bar"><span style={{ width: `${c.total ? (100 * c.done) / c.total : 0}%` }} /></div>
        <button className="start" onClick={() => onOpen(c.id)}>{c.done === 0 ? 'Start' : c.done >= c.total && c.total ? 'Review' : 'Continue'}</button>
        <div className="foot">
          <select aria-label="Group" value={c.group_id || ''} onChange={(e) => call('courses:setGroup', c.id, e.target.value ? +e.target.value : null).then(load)}>
            <option value="">No group</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button className="ghost" onClick={async () => { if (await ask(`Delete "${c.title}" and its notes?`)) call('courses:delete', c.id).then(load); }}>Delete</button>
        </div>
      </div>
    </article>
  );

  return (
    <div className="home">
      {dialog}
      <header>
        <div>
          <h1>LiboMeter</h1>
          <p className="sub">{stats.streak || 0} day streak · {hours(stats.seconds || 0)} hours studied · {stats.done || 0} of {stats.total || 0} videos done</p>
        </div>
        <div className="actions">
          <div className="themes" role="group" aria-label="Theme">
            {THEMES.map(([k, n, c]) => <button key={k} className={'sw' + (theme === k ? ' sel' : '')} aria-label={n + ' theme'} title={n} onClick={() => onTheme(k)}><span style={{ background: c }} /></button>)}
          </div>
          <button className="ghost" onClick={onAbout}>About</button>
          <button className="ghost" onClick={() => toggle('key')}>API key</button>
          <button className="ghost" onClick={() => toggle('custom')}>+ Custom playlist</button>
          <button onClick={() => toggle('import')}>+ Import playlist</button>
        </div>
      </header>

      {panel === 'key' && <div className="panel"><p>Importing needs a free YouTube Data API v3 key. It stays on this computer.</p>
        <div className="row"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste API key" /><button onClick={saveKey}>Save key</button></div></div>}
      {panel === 'import' && <form className="panel" onSubmit={importIt}><p>{inGroup ? `This playlist will be added to the group "${inGroup.name}".` : 'Paste a public or unlisted YouTube playlist link.'}</p>
        <div className="row"><input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=…" /><button disabled={busy || !url.trim()}>{busy ? 'Importing…' : 'Import'}</button></div></form>}
      {panel === 'custom' && <form className="panel" onSubmit={createCustom}><p>Name your playlist, then add videos to it by pasting links.</p>
        <div className="row"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Study music" /><button disabled={!title.trim()}>Create</button></div></form>}
      {err && <p className="err">{err}</p>}

      <div className="toolbar">
        <div className="row">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses…" />
          <button className={chip(view === 'grid')} onClick={() => setV('grid')}>Grid</button>
          <button className={chip(view === 'list')} onClick={() => setV('list')}>List</button>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className="sortsel">
            <option value="new">Sort: Newest</option><option value="az">Sort: A to Z</option><option value="progress">Sort: Progress</option>
          </select>
        </div>
        <div className="badges"><span className="pill">{plural(courses.length, 'playlist')}</span><span className="pill">{plural(groups.length, 'group')}</span></div>
      </div>

      <div className="chips">
        <button className={chip(active === 'all')} onClick={() => setActive('all')}>All ({courses.length})</button>
        {groups.map((g) => <button key={g.id} className={chip(active === g.id)} onClick={() => setActive(g.id)}>{g.name} ({g.n})</button>)}
        {groups.length > 0 && <button className={chip(active === 'none')} onClick={() => setActive('none')}>Ungrouped ({courses.filter((c) => !c.group_id).length})</button>}
        {newGroup === null ? <button className="chip add" onClick={() => setNewGroup('')}>+ New group</button>
          : <form className="chipform" onSubmit={addGroup}><input autoFocus value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name, e.g. Statistics" /><button disabled={!newGroup.trim()}>Add</button><button type="button" className="ghost" onClick={() => setNewGroup(null)}>Cancel</button></form>}
        {inGroup && <button className="ghost small" onClick={delGroup}>Delete this group</button>}
      </div>

      {shown.length === 0 ? <p className="empty">{courses.length === 0 ? 'No playlists yet. Click "Import playlist" or "Custom playlist" to begin.' : 'Nothing here yet. Import a playlist while this group is selected, or move one using the group menu on a card.'}</p>
        : <div className={view === 'list' ? 'list' : 'grid'}>{shown.map(card)}</div>}
    </div>
  );
}

function Course({ id, onBack }) {
  const [course, setCourse] = useState(null);
  const [videos, setVideos] = useState([]);
  const [idx, setIdx] = useState(0);
  const [notes, setNotes] = useState([]);
  const [text, setText] = useState('');
  const [links, setLinks] = useState('');
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);
  const [focus, setFocus] = useState(false);
  const [shuf, setShuf] = useState('');
  const [ask, dialog] = useConfirm();
  const player = useRef(null), noteBox = useRef(null), noteTs = useRef(0), queue = useRef([]), dragFrom = useRef(null);
  const cur = videos[idx];
  const curRef = useRef(); curRef.current = cur;
  const vidsRef = useRef(); vidsRef.current = videos;
  const idxRef = useRef(); idxRef.current = idx;
  const shufRef = useRef(); shufRef.current = shuf;
  const patch = (vid, p) => setVideos((vs) => vs.map((v) => (v.id === vid ? { ...v, ...p } : v)));
  const now = () => Math.floor(player.current?.getCurrentTime?.() || 0);

  const loadVideos = useCallback(async (keepId) => {
    const vs = await call('videos:list', id);
    setVideos(vs);
    setIdx(Math.max(0, keepId ? vs.findIndex((v) => v.id === keepId) : vs.findIndex((v) => !v.completed)));
  }, [id]);
  useEffect(() => { loadVideos(); call('courses:list').then((cs) => setCourse(cs.find((c) => c.id === id))); }, [loadVideos, id]);

  const advance = () => {
    const vs = vidsRef.current;
    if (shufRef.current) {
      queue.current = queue.current.filter((x) => x !== curRef.current.id);
      if (queue.current[0]) return setIdx(vs.findIndex((v) => v.id === queue.current[0]));
      setShuf('');
    }
    if (idxRef.current < vs.length - 1) setIdx(idxRef.current + 1);
  };
  const advRef = useRef(); advRef.current = advance;

  useEffect(() => {
    let p;
    loadYT().then(() => {
      p = new window.YT.Player('yt', { width: '100%', height: '100%', playerVars: { rel: 0, modestbranding: 1 }, events: {
        onReady: () => { player.current = p; setReady(true); },
        onStateChange: (e) => {
          if (e.data !== 0) return;
          const v = curRef.current;
          call('videos:progress', v.id, v.duration, true); patch(v.id, { watched: v.duration, completed: 1 });
          advRef.current();
        } } });
    });
    return () => p?.destroy?.();
  }, []);

  useEffect(() => {
    if (!ready || !cur) return;
    player.current.loadVideoById({ videoId: cur.yt_id, startSeconds: cur.completed ? 0 : cur.watched });
    call('notes:list', cur.id).then(setNotes);
  }, [ready, cur?.id]);

  useEffect(() => {
    const t = setInterval(() => {
      const v = curRef.current;
      if (!v || player.current?.getPlayerState?.() !== 1) return;
      const s = now(), done = v.duration > 0 && s >= v.duration * 0.9;
      call('videos:progress', v.id, s, done); call('stats:addTime', 5); patch(v.id, { watched: s, ...(done && { completed: 1 }) });
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const reorder = async (from, to) => {
    if (to < 0 || to >= videos.length || from === to) return;
    const nv = [...videos]; const [m] = nv.splice(from, 1); nv.splice(to, 0, m);
    const curId = cur?.id;
    setVideos(nv); setIdx(Math.max(0, nv.findIndex((v) => v.id === curId)));
    await call('videos:reorder', id, nv.map((v) => v.id));
  };
  const resetOrder = async () => { if (await ask('Restore the original playlist order?', 'Restore')) { await call('videos:resetOrder', id); loadVideos(cur?.id); } };
  const startShuffle = (mode) => {
    const ids = videos.filter((v) => mode === 'all' || !v.completed).map((v) => v.id);
    if (!ids.length) return setMsg('Nothing to shuffle: every video is done.');
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    queue.current = ids; setShuf(mode); setMsg(''); setIdx(videos.findIndex((v) => v.id === ids[0]));
  };
  const addLinks = async () => {
    try { const r = await call('videos:addLinks', id, links); setMsg(`Added ${r.added}, skipped ${r.skipped}.`); setLinks(''); loadVideos(cur?.id); }
    catch (ex) { setMsg(clean(ex.message)); }
  };
  const addNote = async (kind, body) => { if (!cur) return; await call('notes:add', cur.id, kind === 'note' ? noteTs.current : now(), body, kind); setNotes(await call('notes:list', cur.id)); };
  const submit = (e) => { e.preventDefault(); if (text.trim()) { addNote('note', text.trim()); setText(''); } };

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.altKey && e.key === 'ArrowRight') setIdx((i) => Math.min(i + 1, vidsRef.current.length - 1));
      else if (e.altKey && e.key === 'ArrowLeft') setIdx((i) => Math.max(i - 1, 0));
      else if (e.key === 'n') { e.preventDefault(); noteBox.current?.focus(); }
      else if (e.key === 'b') addNote('bookmark', 'Bookmark');
      else if (e.key === 'f') setFocus((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const done = videos.filter((v) => v.completed).length;
  return (
    <div className={'course' + (focus ? ' focus' : '')}>
      {dialog}
      <main>
        <div className="top">
          <button className="ghost" onClick={onBack}>Back to library</button>
          <span>{course?.title ? course.title + ' · ' : ''}{done} of {videos.length} done</span>
          <button className="ghost" onClick={() => setFocus(!focus)}>{focus ? 'Show playlist' : 'Focus mode'}</button>
        </div>
        <div className="player"><div id="yt" /></div>
        <h2>{cur?.title || (course?.custom ? 'Add videos to start' : '')}</h2>
        <section className="notes">
          <form onSubmit={submit} className="row">
            <input ref={noteBox} value={text} placeholder="Write a note at this moment (n)" onFocus={() => (noteTs.current = now())} onChange={(e) => setText(e.target.value)} />
            <button disabled={!text.trim()}>Save note</button>
            <button type="button" className="ghost" onClick={() => addNote('bookmark', 'Bookmark')}>Bookmark (b)</button>
          </form>
          {notes.length === 0 && <p className="empty">No notes on this video yet.</p>}
          <ul>{notes.map((n) => (
            <li key={n.id} className={n.kind}>
              <button className="ts" onClick={() => player.current?.seekTo(n.ts, true)}>{fmt(n.ts)}</button>
              <span>{n.kind === 'bookmark' ? `★ ${n.text}` : n.text}</span>
              <button className="ghost" onClick={() => call('notes:delete', n.id).then(() => call('notes:list', cur.id).then(setNotes))}>Remove</button>
            </li>))}</ul>
        </section>
      </main>
      <aside>
        <h3>Playlist</h3>
        <div className="tools">
          {shuf ? <button className="ghost small" onClick={() => setShuf('')}>Stop shuffle</button> : <><button className="ghost small" onClick={() => startShuffle('all')}>Shuffle all</button><button className="ghost small" onClick={() => startShuffle('unwatched')}>Shuffle unwatched</button></>}
          <button className="ghost small" onClick={resetOrder}>Reset order</button>
        </div>
        {msg && <p className="dim">{msg}</p>}
        {course?.custom ? <div className="addbox"><textarea aria-label="Video links" rows={3} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="Paste YouTube video links, one per line" /><button disabled={!links.trim()} onClick={addLinks}>Add videos</button></div> : null}
        <ol>{videos.map((v, i) => (
          <li key={v.id} draggable className={'vrow' + (i === idx ? ' active' : '')} onClick={() => setIdx(i)}
            onDragStart={() => { dragFrom.current = i; }} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragFrom.current !== null) reorder(dragFrom.current, i); dragFrom.current = null; }}>
            <span className="grip" aria-hidden="true">⋮⋮</span>
            <input type="checkbox" aria-label="Done" checked={!!v.completed} onClick={(e) => e.stopPropagation()} onChange={() => call('videos:toggle', v.id).then(() => patch(v.id, { completed: v.completed ? 0 : 1 }))} />
            <span className="vt">{v.title}</span><small>{fmt(v.duration)}</small>
            <button className="ar" aria-label="Move up" onClick={(e) => { e.stopPropagation(); reorder(i, i - 1); }}>▲</button>
            <button className="ar" aria-label="Move down" onClick={(e) => { e.stopPropagation(); reorder(i, i + 1); }}>▼</button>
            {course?.custom ? <button className="ar" aria-label="Remove video" onClick={async (e) => { e.stopPropagation(); if (await ask('Remove this video from the playlist?', 'Remove')) call('videos:delete', v.id).then(() => loadVideos(cur?.id === v.id ? undefined : cur?.id)); }}>✕</button> : null}
          </li>))}</ol>
        <p className="keys">n note · b bookmark · f focus · Alt+←/→ previous/next · drag ⋮⋮ to reorder</p>
      </aside>
    </div>
  );
}
