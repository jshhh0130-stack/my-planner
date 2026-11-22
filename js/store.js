// 데이터 저장소
// - 로그인 전: 이 기기 안(IndexedDB)에만 저장 → 인터넷 없어도 동작
// - 구글 로그인 후: Firebase(클라우드)에 저장 → 핸드폰·노트북·패드 실시간 연동
import { uid, wdIdx, parseKey } from './util.js';

export const PRI_N = 10;
export const COLORS = ['blue', 'green', 'pink', 'yellow', 'purple', 'gray'];

export function emptyDay(date) {
  return {
    date,
    goal: '',
    priorities: Array.from({ length: PRI_N }, () => ({ text: '', done: false, missed: false })),
    tasks: [],
    notes: [],
    carried: false,
    carryDismissed: false,
    updatedAt: 0,
  };
}

export function normDay(d) {
  const out = emptyDay(d.date);
  out.goal = typeof d.goal === 'string' ? d.goal : '';
  const p = Array.isArray(d.priorities) ? d.priorities : [];
  out.priorities = out.priorities.map((_, i) => ({
    text: p[i]?.text || '',
    done: !!p[i]?.done,
    missed: !p[i]?.done && !!p[i]?.missed, // ✓ 했음 / ✗ 못함 (둘 중 하나만)
  }));
  out.tasks = (Array.isArray(d.tasks) ? d.tasks : [])
    .filter(Boolean)
    .map((t) => ({ id: t.id || uid(), text: t.text || '', done: !!t.done }));
  out.notes = (Array.isArray(d.notes) ? d.notes : [])
    .filter(Boolean)
    .map((n) => ({ id: n.id || uid(), text: n.text || '', at: n.at || 0, photos: Array.isArray(n.photos) ? n.photos.filter(Boolean) : [] }));
  out.carried = !!d.carried;
  out.carryDismissed = !!d.carryDismissed;
  out.updatedAt = d.updatedAt || 0;
  return out;
}

export function isEmptyDay(d) {
  return (
    !d.goal &&
    d.priorities.every((p) => !p.text) &&
    !d.tasks.length &&
    !d.notes.length &&
    !d.carried &&
    !d.carryDismissed
  );
}

export function normEvent(e) {
  const repeat = ['none', 'daily', 'weekdays', 'weekly', 'monthly'].includes(e.repeat) ? e.repeat : 'none';
  const days = Array.isArray(e.days)
    ? [...new Set(e.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : [];
  return {
    id: e.id,
    title: e.title || '',
    date: e.date,
    // 여러 날 일정(반복 없음)의 마지막 날 — 하루짜리는 date와 같음
    endDate: repeat === 'none' && e.endDate && e.endDate > e.date ? e.endDate : e.date,
    start: e.start || '09:00',
    end: e.end || '10:00',
    allDay: !!e.allDay,
    repeat,
    days, // 매주 반복 요일 (월=0 … 일=6)
    until: e.until || '',
    exdates: Array.isArray(e.exdates) ? e.exdates : [],
    color: COLORS.includes(e.color) ? e.color : 'blue',
    note: e.note || '',
    updatedAt: e.updatedAt || 0,
  };
}

export const weekDaysOf = (ev) => (ev.repeat === 'weekdays' ? [0, 1, 2, 3, 4] : ev.days && ev.days.length ? ev.days : [wdIdx(ev.date)]);

// 이 일정이 날짜 k에 있는지 (여러 날 · 반복 포함)
export function occursOn(ev, k) {
  if (ev.exdates.includes(k)) return false;
  if (ev.repeat === 'none') return k >= ev.date && k <= (ev.endDate || ev.date);
  if (k < ev.date) return false;
  if (ev.until && k > ev.until) return false;
  if (ev.repeat === 'daily') return true;
  if (ev.repeat === 'weekdays' || ev.repeat === 'weekly') return weekDaysOf(ev).includes(wdIdx(k));
  if (ev.repeat === 'monthly') return parseKey(k).getDate() === parseKey(ev.date).getDate();
  return false;
}

// 여러 날 일정은 날마다 보여 줄 부분으로: 첫날 시작~24시, 가운데 날 하루 종일, 마지막 날 0시~끝
function partOf(ev, k) {
  if (ev.repeat !== 'none' || !ev.endDate || ev.endDate === ev.date) return ev;
  if (ev.allDay) return { ...ev, _multi: 'all' };
  if (k === ev.date) return { ...ev, end: '24:00', _multi: 'first' };
  if (k === ev.endDate) return ev.end === '00:00' ? null : { ...ev, start: '00:00', _multi: 'last' };
  return { ...ev, allDay: true, _multi: 'mid' };
}

// 두 기기에 같은 날 기록이 있을 때 합치기 (아무것도 버리지 않음)
export function mergeDays(a, b) {
  const out = normDay(a);
  const l = normDay(b);
  if (!out.goal) out.goal = l.goal;
  out.priorities = out.priorities.map((p, i) => (p.text ? p : l.priorities[i]));
  const tIds = new Set(out.tasks.map((t) => t.id));
  for (const t of l.tasks) if (!tIds.has(t.id)) out.tasks.push(t);
  const nIds = new Set(out.notes.map((n) => n.id));
  for (const n of l.notes) if (!nIds.has(n.id)) out.notes.push(n);
  out.notes.sort((x, y) => x.at - y.at);
  out.carried = out.carried || l.carried;
  out.carryDismissed = out.carryDismissed || l.carryDismissed;
  out.updatedAt = Date.now();
  return out;
}

/* ---------------- 이 기기 저장 (IndexedDB) ---------------- */
export class LocalBackend {
  constructor(dbName = 'daily-planner') {
    this.name = 'local';
    this.dbName = dbName;
    this.bc = null;
  }

  async open() {
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(this.dbName, 2);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [s, k] of [['days', 'date'], ['events', 'id'], ['photos', 'id'], ['meta', 'key'], ['ink', 'date']]) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: k });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if ('BroadcastChannel' in self) this.bc = new BroadcastChannel(this.dbName);
  }

  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  getAll(s) { return this.tx(s, 'readonly', (o) => o.getAll()); }
  get(s, k) { return this.tx(s, 'readonly', (o) => o.get(k)); }
  put(s, v) { return this.tx(s, 'readwrite', (o) => o.put(v)); }
  del(s, k) { return this.tx(s, 'readwrite', (o) => o.delete(k)); }

  // 같은 기기에서 창을 두 개 열어도 서로 맞춰 줌
  async subscribe(cb) {
    const [days, events, s] = await Promise.all([this.getAll('days'), this.getAll('events'), this.get('meta', 'settings')]);
    cb({ days, events, settings: s?.value || {} });
    if (this.bc) {
      this.bc.onmessage = async ({ data: m }) => {
        if (m.t === 'settings') {
          cb({ settings: (await this.get('meta', 'settings'))?.value || {} });
        } else if (m.t === 'day') {
          const d = await this.get('days', m.k);
          cb({ days: [d || { date: m.k, _deleted: true }] });
        } else if (m.t === 'event') {
          const e = await this.get('events', m.k);
          cb({ events: [e || { id: m.k, _deleted: true }] });
        }
      };
    }
  }
  unsubscribe() { if (this.bc) this.bc.onmessage = null; }

  async putDay(d) { await this.put('days', d); this.bc?.postMessage({ t: 'day', k: d.date }); }
  async deleteDay(k) { await this.del('days', k); this.bc?.postMessage({ t: 'day', k }); }
  async putEvent(e) { await this.put('events', e); this.bc?.postMessage({ t: 'event', k: e.id }); }
  async deleteEvent(id) { await this.del('events', id); this.bc?.postMessage({ t: 'event', k: id }); }
  async putSettings(v) { await this.put('meta', { key: 'settings', value: v }); this.bc?.postMessage({ t: 'settings' }); }
  // 시간표 펜 필기 (날짜별)
  async putInk(doc) { await this.put('ink', doc); this.bc?.postMessage({ t: 'ink', k: doc.date }); }
  watchInk(k, cb) {
    let alive = true;
    this.get('ink', k).then((d) => { if (alive) cb(d || null); });
    const fn = async ({ data: m }) => { if (alive && m.t === 'ink' && m.k === k) cb((await this.get('ink', k)) || null); };
    this.bc?.addEventListener('message', fn);
    return () => { alive = false; this.bc?.removeEventListener('message', fn); };
  }
  putPhoto(p) { return this.put('photos', p); }
  async getPhoto(id) { return (await this.get('photos', id))?.data || null; }
  deletePhoto(id) { return this.del('photos', id); }
  allPhotos() { return this.getAll('photos'); }
}

/* ---------------- 저장소 본체 ---------------- */
export class Store {
  constructor() {
    this.days = new Map();
    this.events = new Map();
    this.settings = {};
    this.timers = new Map();
    this.photoCache = new Map();
    this.fns = new Set();
    this.backend = null;
    this.local = null;
    this.cloud = null;
    this.status = { mode: 'local', hasConfig: false, user: null, pending: 0, online: navigator.onLine, error: '' };
    addEventListener('online', () => this.setStatus({ online: true }));
    addEventListener('offline', () => this.setStatus({ online: false }));
  }

  on(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  emit(type) { for (const fn of this.fns) fn(type); }
  setStatus(p) { Object.assign(this.status, p); this.emit('status'); }

  async start(local) {
    this.local = local;
    await this.attach(local);
  }

  async attach(backend) {
    this.flushAll();
    this.backend?.unsubscribe?.();
    this.backend = backend;
    this.days.clear();
    this.events.clear();
    this.settings = {};
    this.setStatus({ mode: backend.name, error: '' });
    await backend.subscribe((ch) => this.apply(ch));
    this.emit('data');
  }

  // 저장소(클라우드·다른 창)에서 온 변경 반영
  apply({ days = [], events = [], settings }) {
    let changed = false;
    if (settings && JSON.stringify(settings) !== JSON.stringify(this.settings)) {
      this.settings = settings;
      this.emit('settings');
    }
    for (const raw of days) {
      if (!raw || !raw.date) continue;
      if (this.timers.has(raw.date)) continue; // 지금 이 기기에서 고치는 중인 날은 덮어쓰지 않음
      if (raw._deleted) { if (this.days.delete(raw.date)) changed = true; continue; }
      const d = normDay(raw);
      const cur = this.days.get(d.date);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(d)) { this.days.set(d.date, d); changed = true; }
    }
    for (const raw of events) {
      if (!raw || !raw.id) continue;
      if (raw._deleted) { if (this.events.delete(raw.id)) changed = true; continue; }
      const e = normEvent(raw);
      const cur = this.events.get(e.id);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(e)) { this.events.set(e.id, e); changed = true; }
    }
    if (changed) this.emit('data');
  }

  /* 하루 페이지 */
  day(k) { return this.days.get(k) || emptyDay(k); }

  editDay(k, fn) {
    const d = structuredClone(this.day(k));
    fn(d);
    d.updatedAt = Date.now();
    this.days.set(k, d);
    clearTimeout(this.timers.get(k));
    this.timers.set(k, setTimeout(() => this.flushDay(k), 450));
    return d;
  }

  flushDay(k) {
    clearTimeout(this.timers.get(k));
    this.timers.delete(k);
    const d = this.days.get(k);
    if (!d || !this.backend) return Promise.resolve();
    const p = isEmptyDay(d) ? this.backend.deleteDay(k) : this.backend.putDay(d);
    this.track(p);
    return p;
  }
  flushAll() {
    return Promise.all([...this.timers.keys()].map((k) => this.flushDay(k).catch(() => {})));
  }

  track(p) {
    if (!p || !p.then) return;
    this.setStatus({ pending: this.status.pending + 1 });
    p.then(
      () => this.setStatus({ pending: Math.max(0, this.status.pending - 1), error: '' }),
      (err) => {
        console.error(err);
        this.setStatus({ pending: Math.max(0, this.status.pending - 1), error: String(err?.code || err?.message || err) });
      },
    );
  }

  /* 시간표 펜 필기 */
  watchInk(k, cb) { return this.backend?.watchInk ? this.backend.watchInk(k, cb) : () => {}; }
  saveInk(k, strokes) { this.track(this.backend.putInk({ date: k, strokes, updatedAt: Date.now() })); }

  /* 설정 (캘린더 연결 등) — 로그인하면 모든 기기에 같이 적용 */
  saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.track(this.backend.putSettings(this.settings));
    this.emit('settings');
  }

  addNote(k, text, photos = []) {
    const n = { id: uid(), text, at: Date.now(), photos };
    this.editDay(k, (d) => d.notes.push(n));
    return n;
  }

  /* 일정 */
  eventsOn(k) {
    const out = [];
    for (const e of this.events.values()) {
      if (!occursOn(e, k)) continue;
      const p = partOf(e, k);
      if (p) out.push(p);
    }
    return out.sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  }
  saveEvent(e) {
    const ev = normEvent({ ...e, id: e.id || uid(), updatedAt: Date.now() });
    this.events.set(ev.id, ev);
    this.track(this.backend.putEvent(ev));
    return ev;
  }
  deleteEvent(id) {
    this.events.delete(id);
    this.track(this.backend.deleteEvent(id));
  }
  skipOccurrence(id, k) {
    const e = this.events.get(id);
    if (e) this.saveEvent({ ...e, exdates: [...e.exdates, k] });
  }

  /* 사진 (작게 줄여서 저장) */
  async addPhoto(date, data) {
    const p = { id: uid(), date, data, createdAt: Date.now() };
    this.photoCache.set(p.id, data);
    this.track(this.backend.putPhoto(p));
    return p.id;
  }
  async getPhoto(id) {
    if (this.photoCache.has(id)) return this.photoCache.get(id);
    let data = null;
    try { data = await this.backend.getPhoto(id); } catch (e) { console.warn(e); }
    if (!data && this.backend !== this.local) {
      try { data = await this.local.getPhoto(id); } catch { /* 없음 */ }
    }
    if (data) this.photoCache.set(id, data);
    return data;
  }
  deletePhoto(id) {
    this.photoCache.delete(id);
    this.track(this.backend.deletePhoto(id));
  }

  /* 클라우드 연결 */
  async connectCloud(cloud) {
    this.cloud = cloud;
    cloud.onError = (err) => this.setStatus({ error: String(err?.code || err?.message || err) });
    this.setStatus({ hasConfig: true });
    cloud.onAuth(async (user) => {
      this.setStatus({ user: user ? { email: user.email || '', name: user.displayName || '' } : null });
      if (user) {
        try { await this.migrate(); } catch (e) { console.error('옮기기 실패', e); }
        await this.attach(cloud);
      } else if (this.backend !== this.local) {
        await this.attach(this.local);
      }
    });
  }

  // 로그인 전에 이 기기에 적어 둔 기록을 처음 로그인할 때 클라우드로 올림
  async migrate() {
    const local = this.local;
    const cloud = this.cloud;
    const key = `migrated:${cloud.user.uid}`;
    if (await local.get('meta', key)) return;
    if (this.backend === local) await this.flushAll();
    const [ld, le, lp] = await Promise.all([local.getAll('days'), local.getAll('events'), local.getAll('photos')]);
    if (ld.length || le.length || lp.length) {
      let remote = { days: [], events: [] };
      try { remote = await cloud.getAll(); } catch (e) { console.warn(e); }
      const rd = new Map(remote.days.map((d) => [d.date, d]));
      const re = new Set(remote.events.map((e) => e.id));
      for (const d of ld) {
        const r = rd.get(d.date);
        this.track(cloud.putDay(r ? mergeDays(r, d) : normDay(d)));
      }
      for (const e of le) if (!re.has(e.id)) this.track(cloud.putEvent(normEvent(e)));
      for (const p of lp) this.track(cloud.putPhoto(p));
    }
    await local.put('meta', { key, at: Date.now() });
  }

  /* 백업 */
  async exportAll() {
    this.flushAll();
    let photos = [];
    try { photos = await this.backend.allPhotos(); } catch (e) { console.warn(e); }
    return {
      app: 'daily-planner',
      v: 1,
      exportedAt: new Date().toISOString(),
      days: [...this.days.values()].filter((d) => !isEmptyDay(d)),
      events: [...this.events.values()],
      photos,
    };
  }

  async importAll(data) {
    if (!data || data.app !== 'daily-planner') throw new Error('플래너 백업 파일이 아니에요');
    let n = 0;
    for (const raw of data.days || []) {
      if (!raw?.date) continue;
      const cur = this.days.get(raw.date);
      const d = cur && !isEmptyDay(cur) ? mergeDays(cur, raw) : normDay(raw);
      this.days.set(d.date, d);
      this.track(this.backend.putDay(d));
      n++;
    }
    for (const raw of data.events || []) {
      if (!raw?.id || this.events.has(raw.id)) continue;
      const e = normEvent(raw);
      this.events.set(e.id, e);
      this.track(this.backend.putEvent(e));
    }
    for (const p of data.photos || []) if (p?.id && p.data) this.track(this.backend.putPhoto(p));
    this.emit('data');
    return n;
  }
}

export const store = new Store();
