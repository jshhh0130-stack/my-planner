// 구글 캘린더(삼성 캘린더와 동기화된 일정 포함) 불러오기 — 읽기 전용
// 내 구글 계정의 Apps Script 웹 앱이 캘린더를 읽어 JSON으로 돌려줌 → 토큰 갱신 필요 없음
import { addDays, todayKey, keyOf, parseKey, fromMin } from './util.js';

const REFRESH_MS = 20 * 60 * 1000; // 20분마다(화면을 보고 있을 때만)
const STALE_MS = 10 * 60 * 1000;   // 앱을 열 때 10분 넘게 지났으면 새로 받기

export const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#4a6fb5');

// Apps Script에 붙여 넣을 코드 (key는 앱이 만들어 넣어 줌)
export function scriptCode(key) {
  return `// 데일리 플래너 ↔ 구글 캘린더 연결 (읽기 전용 · 이 코드는 내 일정을 읽기만 해요)
const KEY = '${key}';

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.key !== KEY) return out_({ error: 'bad-key' });
  const from = p.from ? new Date(p.from) : new Date(Date.now() - 35 * 864e5);
  const to = p.to ? new Date(p.to) : new Date(Date.now() + 120 * 864e5);
  const tz = Session.getScriptTimeZone();
  const calendars = [];
  const events = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    try {
      const cid = cal.getId();
      calendars.push({ id: cid, name: cal.getName(), color: cal.getColor() });
      cal.getEvents(from, to).forEach(function (ev) {
        const item = { id: ev.getId(), cal: cid, title: ev.getTitle(), allDay: ev.isAllDayEvent(), location: ev.getLocation() || '' };
        if (item.allDay) {
          item.startDate = Utilities.formatDate(ev.getAllDayStartDate(), tz, 'yyyy-MM-dd');
          item.endDate = Utilities.formatDate(ev.getAllDayEndDate(), tz, 'yyyy-MM-dd');
        } else {
          item.start = ev.getStartTime().toISOString();
          item.end = ev.getEndTime().toISOString();
        }
        events.push(item);
      });
    } catch (err) { /* 읽을 수 없는 캘린더는 건너뜀 */ }
  });
  return out_({ ok: true, calendars: calendars, events: events });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

export function newKey() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 28);
}

// 서버에서 받은 일정 → 날짜별 칸으로 펼치기
function expand(raw, calMap) {
  const byDate = new Map();
  const push = (k, ev) => {
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(ev);
  };
  for (const r of raw) {
    const cal = calMap.get(r.cal) || {};
    const base = {
      ext: true, cal: r.cal, calName: cal.name || '', extColor: safeColor(cal.color),
      title: r.title || '(제목 없음)', location: r.location || '',
      color: 'ext', repeat: 'none', exdates: [], note: '',
    };
    if (r.allDay) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate || '')) continue;
      const endEx = r.endDate && r.endDate > r.startDate ? r.endDate : addDays(r.startDate, 1);
      for (let k = r.startDate, n = 0; k < endEx && n < 400; k = addDays(k, 1), n++) {
        push(k, { ...base, id: `g:${r.id}:${r.startDate}:${k}`, date: k, allDay: true, start: '00:00', end: '24:00' });
      }
      continue;
    }
    const s = new Date(r.start);
    const e = new Date(r.end);
    if (Number.isNaN(+s) || Number.isNaN(+e)) continue;
    const sk = keyOf(s);
    const ek = keyOf(new Date(Math.max(+e - 1, +s)));
    const sm = s.getHours() * 60 + s.getMinutes();
    const em = e.getHours() * 60 + e.getMinutes();
    if (sk === ek) {
      const end = em === 0 && +e > +s ? 1440 : Math.max(em, sm + 15);
      push(sk, { ...base, id: `g:${r.id}:${r.start}`, date: sk, allDay: false, start: fromMin(sm), end: fromMin(Math.min(end, 1440)) });
      continue;
    }
    // 여러 날에 걸친 일정: 첫날 ~24:00, 가운데 날은 하루 종일, 마지막 날 00:00~
    push(sk, { ...base, id: `g:${r.id}:${r.start}:a`, date: sk, allDay: false, start: fromMin(sm), end: '24:00' });
    for (let k = addDays(sk, 1), n = 0; k < ek && n < 60; k = addDays(k, 1), n++) {
      push(k, { ...base, id: `g:${r.id}:${r.start}:${k}`, date: k, allDay: true, start: '00:00', end: '24:00' });
    }
    if (em > 0) push(ek, { ...base, id: `g:${r.id}:${r.start}:z`, date: ek, allDay: false, start: '00:00', end: fromMin(em) });
    else push(ek, { ...base, id: `g:${r.id}:${r.start}:z`, date: ek, allDay: false, start: '00:00', end: '24:00' });
  }
  return byDate;
}

const isoOf = (k) => parseKey(k).toISOString();

async function fetchRange(url, key, range) {
  const u = `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}&from=${encodeURIComponent(isoOf(range.from))}&to=${encodeURIComponent(isoOf(addDays(range.to, 1)))}`;
  const res = await fetch(u, { cache: 'no-store' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('not-json'); }
  if (data.error) throw new Error(data.error);
  if (!data.ok) throw new Error('bad-response');
  return data;
}

class GCal {
  constructor() {
    this.url = '';
    this.key = '';
    this.hidden = new Set();
    this.calendars = [];
    this.byDate = new Map();
    this.range = null;
    this.fetchedAt = 0;
    this.count = 0;
    this.loading = false;
    this.error = '';
    this.onChange = null;
    this.timer = null;
    this.lastTry = 0;
  }

  get on() { return !!(this.url && this.key); }

  configure(g) {
    g = g || {};
    const url = g.url || '';
    const key = g.key || '';
    this.hidden = new Set(Array.isArray(g.hidden) ? g.hidden : []);
    const changed = url !== this.url || key !== this.key;
    this.url = url;
    this.key = key;
    if (!this.on) {
      this.byDate = new Map();
      this.calendars = [];
      this.range = null;
      this.error = '';
      clearInterval(this.timer);
      this.timer = null;
      this.changed();
      return;
    }
    if (changed) {
      // 주소·키가 바뀌면 예전 결과는 버리고 새로 받기
      this.byDate = new Map();
      this.calendars = [];
      this.range = null;
      this.fetchedAt = 0;
      this.count = 0;
      this.error = '';
      this.loadCache();
      if (!this.timer) {
        this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, REFRESH_MS);
      }
      if (Date.now() - this.fetchedAt > STALE_MS) this.refresh();
    }
    this.changed();
  }

  changed() { this.onChange?.(); }

  cacheKey() {
    let h = 0;
    for (const ch of `${this.url}|${this.key}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return `gcal:${(h >>> 0).toString(36)}`;
  }

  loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(this.cacheKey()) || 'null');
      if (c && c.events) this.ingest(c, c.fetchedAt, c.range);
    } catch { /* 무시 */ }
  }

  ingest(data, fetchedAt, range) {
    this.calendars = (data.calendars || []).map((c) => ({ id: String(c.id), name: String(c.name || ''), color: safeColor(c.color) }));
    const calMap = new Map(this.calendars.map((c) => [c.id, c]));
    this.byDate = expand(data.events || [], calMap);
    this.count = (data.events || []).length;
    this.fetchedAt = fetchedAt || Date.now();
    this.range = range || null;
  }

  // 지금 보는 날짜가 받아 둔 범위 밖이면 그 주변을 새로 받기 (실패했으면 1분은 쉬기)
  ensure(k) {
    if (!this.on || this.loading) return;
    if (this.error && Date.now() - this.lastTry < 60000) return;
    if (!this.range || k < this.range.from || k > this.range.to) this.refresh({ around: k });
  }

  // 연결하기 전에 주소·키가 맞는지 확인
  async test(url, key) {
    try {
      const data = await fetchRange(url, key, { from: addDays(todayKey(), -40), to: addDays(todayKey(), 120) });
      return { ok: true, count: (data.events || []).length };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async refresh({ around } = {}) {
    if (!this.on || this.loading) return false;
    const center = around || todayKey();
    const range = { from: addDays(center, -40), to: addDays(center, 120) };
    this.loading = true;
    this.lastTry = Date.now();
    this.changed();
    try {
      const data = await fetchRange(this.url, this.key, range);
      this.ingest(data, Date.now(), range);
      this.error = '';
      try {
        localStorage.setItem(this.cacheKey(), JSON.stringify({ calendars: data.calendars, events: data.events, fetchedAt: this.fetchedAt, range }));
      } catch { /* 저장 공간 부족 등은 무시 */ }
      return true;
    } catch (e) {
      this.error = String(e?.message || e);
      return false;
    } finally {
      this.loading = false;
      this.changed();
    }
  }

  eventsOn(k) {
    const list = this.byDate.get(k);
    if (!list || !this.on) return [];
    return this.hidden.size ? list.filter((e) => !this.hidden.has(e.cal)) : list;
  }
}

export const gcal = new GCal();

export function gcalErrorText(err) {
  const s = String(err || '');
  if (s === 'bad-key') return '연결 코드의 키가 맞지 않아요. 설정에서 "연결 코드 복사"를 다시 해서 붙여 넣어 주세요.';
  if (s === 'not-json') return '연결 주소가 웹 앱 주소가 아니거나, 배포의 "액세스 권한"이 "모든 사용자"가 아니에요.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(s)) return '캘린더를 불러오지 못했어요. 인터넷 연결이나 연결 주소를 확인해 주세요.';
  return s ? `캘린더를 불러오지 못했어요 (${s})` : '';
}
