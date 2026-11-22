// Daily Planner — 화면과 동작
import { store, LocalBackend, COLORS, isEmptyDay } from './store.js';
import { firebaseConfig } from './firebase-config.js';
import {
  pad, keyOf, parseKey, todayKey, addDays, addMonths, dayDiff, wdIdx, WD, WD_FULL, startOfWeek,
  toMin, fromMin, clamp, uid, esc, escRe, hhmm, richText, md, relLabel,
} from './util.js';

const H0 = 5;   // 시간표 시작 05시 (교수님 양식과 같게)
const H1 = 24;  // 23시 칸까지
const TOTAL = (H1 - H0) * 60;
const SETUP_URL = 'https://github.com/jshhh0130-stack/my-planner/blob/main/SETUP.md';

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const I = {
  left: svg('<path d="M15 6l-6 6 6 6"/>'),
  right: svg('<path d="M9 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  cam: svg('<path d="M4 8.5h3.2L9 6h6l1.8 2.5H20V19H4z"/><circle cx="12" cy="13.2" r="3.4"/>'),
  img: svg('<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9.2" cy="10" r="1.6"/><path d="M5 17.5l4.6-4.6 3.6 3.6 2.2-2.2 3.6 3.6"/>'),
  today: svg('<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/>'),
  cal: svg('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 9.8h16M8.5 3.2v3.6M15.5 3.2v3.6"/>'),
  book: svg('<path d="M6 4.5h9.5A2.5 2.5 0 0118 7v13H8.5A2.5 2.5 0 016 17.5z"/><path d="M6 17.5A2.5 2.5 0 018.5 15H18"/>'),
  gear: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  memo: svg('<path d="M5.5 4h13v11.5L14 20H5.5z"/><path d="M14 20v-4.5h4.5M8.5 8.5h7M8.5 12h4"/>'),
  search: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>'),
  trash: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>'),
  down: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  repeat: svg('<path d="M4.5 11V9.5a4 4 0 014-4H18M15 2.5l3 3-3 3M19.5 13v1.5a4 4 0 01-4 4H6M9 21.5l-3-3 3-3"/>'),
};

const isPhone = () => matchMedia('(max-width: 760px)').matches;
const $view = document.getElementById('view');

const S = {
  view: 'today',
  date: todayKey(),
  pane: 'tasks',
  showAllPri: false,
  editingNote: null,
  drafts: {},
  photoTarget: null,
  lastColor: localStorage.getItem('lastColor') || 'blue',
  cal: {
    mode: localStorage.getItem('calMode') || (isPhone() ? 'month' : 'week'),
    anchor: todayKey(),
    sel: todayKey(),
    scrolled: false,
  },
  rec: { q: '', filter: 'all', limit: 20 },
  memoDays: 14,
};

let pendingRender = false;
let pointerDown = false;
let dragging = false;
let deferredInstall = null;
let modal = null;
let skipPop = false;
let lastToday = todayKey();
let composeEnter = null;
let composeTimer = null;
let composeDoneAt = 0;
let runningVersion = null;

/* ---------------- 작은 도우미 ---------------- */
const pctOf = (m) => `${((m - H0 * 60) / TOTAL) * 100}%`;
const pctLen = (m) => `${(m / TOTAL) * 100}%`;
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hasContent = (d) => !!d && (!!d.goal || d.priorities.some((p) => p.text) || d.tasks.length > 0 || d.notes.length > 0);
const dayHasAny = (k) => hasContent(store.days.get(k)) || store.eventsOn(k).length > 0;
const wdClass = (i) => (i === 5 ? 'sat' : i === 6 ? 'sun' : '');

function getDraft(k) {
  if (S.drafts[k] != null) return S.drafts[k];
  try { return localStorage.getItem(`draft:${k}`) || ''; } catch { return ''; }
}
function setDraft(k, v) {
  S.drafts[k] = v;
  try { v ? localStorage.setItem(`draft:${k}`, v) : localStorage.removeItem(`draft:${k}`); } catch { /* 무시 */ }
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2300);
}

function focusEl(el) {
  if (!el) return;
  el.focus();
  if (typeof el.value === 'string' && el.setSelectionRange) {
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch { /* date 등 */ }
  }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/* ---------------- 그리기 ---------------- */
function canRender() {
  const a = document.activeElement;
  const editing = a && a !== document.body && $view.contains(a) && a.matches('input, textarea, select');
  return !editing && !pointerDown && !dragging;
}
function requestRender() {
  if (canRender()) render();
  else pendingRender = true;
}

function render(opts = {}) {
  pendingRender = false;
  const winY = window.scrollY;
  const inner = {};
  $view.querySelectorAll('[data-keep-scroll]').forEach((el) => { inner[el.dataset.keepScroll] = el.scrollTop; });

  $view.innerHTML = S.view === 'calendar' ? calendarHTML() : S.view === 'records' ? recordsHTML() : todayHTML();
  document.body.dataset.view = S.view;
  document.querySelectorAll('[data-act="go"]').forEach((b) => b.classList.toggle('on', b.dataset.view === S.view));

  if (opts.resetScroll) window.scrollTo(0, 0);
  else {
    window.scrollTo(0, winY);
    $view.querySelectorAll('[data-keep-scroll]').forEach((el) => {
      if (inner[el.dataset.keepScroll] != null) el.scrollTop = inner[el.dataset.keepScroll];
    });
  }
  if (S.view === 'calendar' && S.cal.mode === 'week' && !S.cal.scrolled) {
    const w = $view.querySelector('.wk-scroll');
    if (w && w.scrollHeight > w.clientHeight + 4) {
      w.scrollTop = hourPx() * 2; // 07:00부터 보이게
      S.cal.scrolled = true;
    }
  }
  $view.querySelectorAll('textarea').forEach((t) => { if (t.value) autoGrow(t); });
  hydratePhotos($view);
  if (opts.focus) focusEl($view.querySelector(opts.focus));
  renderStatus();
}

function hourPx() {
  const c = $view.querySelector('.tg-col');
  return c ? c.getBoundingClientRect().height / (H1 - H0) : 48;
}

function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]:not([src])').forEach((img) => {
    store.getPhoto(img.dataset.photo).then((url) => {
      if (url) img.src = url;
      else img.closest('.ph')?.classList.add('missing');
    });
  });
}

function renderStatus() {
  const s = store.status;
  const pill = document.getElementById('syncPill');
  if (!pill) return;
  let cls = 'local';
  let txt = '이 기기에 저장됨';
  if (s.mode === 'cloud') {
    if (!s.online) { cls = 'warn'; txt = '오프라인 · 연결되면 저장'; }
    else if (s.error) { cls = 'err'; txt = '동기화 확인 필요'; }
    else if (s.pending) { cls = 'busy'; txt = '저장 중…'; }
    else { cls = 'ok'; txt = '모든 기기 동기화됨'; }
  } else if (s.hasConfig) {
    cls = 'warn';
    txt = s.user ? '연결 중…' : '로그인하고 연동하기';
  }
  pill.className = `sync-pill ${cls}`;
  pill.querySelector('span').textContent = txt;
}

/* ---------------- 오늘 (첫 화면) ---------------- */
function todayHTML() {
  const k = S.date;
  const d = store.day(k);
  const today = todayKey();
  const isToday = k === today;
  const dt = parseKey(k);
  const ws = startOfWeek(k);
  const strip = Array.from({ length: 7 }, (_, i) => {
    const x = addDays(ws, i);
    return `<button class="ws-day ${x === k ? 'on' : ''} ${x === today ? 'today' : ''} ${wdClass(i)}" data-act="goto-day" data-date="${x}">
      <span class="ws-wd">${WD[i]}</span><span class="ws-dn">${parseKey(x).getDate()}</span><i class="ws-dot ${dayHasAny(x) ? '' : 'off'}"></i></button>`;
  }).join('');

  const pr = d.priorities;
  const prFilled = pr.filter((p) => p.text);
  const evs = store.eventsOn(k);
  const items = [...prFilled, ...d.tasks.filter((t) => t.text)];
  const showAll = S.showAllPri || pr.slice(5).some((p) => p.text);

  return `
  <section class="day-head">
    <div class="dh-left">
      <div class="dh-title">
        <span class="dh-md">${dt.getMonth() + 1}월 ${dt.getDate()}일</span>
        <span class="dh-wd">${WD_FULL[wdIdx(k)]}</span>
        ${isToday ? '<span class="badge">오늘</span>' : ''}
      </div>
      <div class="dh-sub">${dt.getFullYear()}년${isToday ? '' : ` · ${relLabel(k)}`}</div>
    </div>
    <div class="week-strip">${strip}</div>
    <div class="dh-nav">
      <button class="icon-btn" data-act="day-move" data-n="-1" aria-label="어제">${I.left}</button>
      ${isToday ? '' : '<button class="btn sm" data-act="day-today">오늘로</button>'}
      <button class="icon-btn" data-act="day-move" data-n="1" aria-label="내일">${I.right}</button>
    </div>
  </section>
  ${bannersHTML(k, d)}
  <div class="seg day-seg">
    <button class="${S.pane === 'tasks' ? 'on' : ''}" data-act="pane" data-pane="tasks">할 일<em data-count="tasks">${items.filter((x) => x.done).length}/${items.length}</em></button>
    <button class="${S.pane === 'memo' ? 'on' : ''}" data-act="pane" data-pane="memo">메모<em data-count="memo">${d.notes.length}</em></button>
    <button class="${S.pane === 'schedule' ? 'on' : ''}" data-act="pane" data-pane="schedule">시간표<em data-count="sched">${evs.length}</em></button>
  </div>
  <div class="day-grid" data-pane="${S.pane}">
    <section class="col col-tasks">
      <h3 class="label">오늘의 목표</h3>
      <input class="goal-input" data-bind="goal" value="${esc(d.goal)}" placeholder="오늘을 한 줄로 정해 보세요" autocomplete="off" enterkeyhint="next">
      <h3 class="label">우선순위<small data-count="pri">${priSummary(d)}</small><span class="pri-legend"><i>했음</i><i>못함</i></span></h3>
      <ol class="pri-list ${showAll ? 'all' : ''}">
        ${pr.map((p, i) => `<li class="pri ${p.done ? 'done' : ''} ${p.missed ? 'miss' : ''} ${i >= 5 ? 'extra' : ''}">
          <span class="pri-no">${pad(i + 1)}</span>
          <input class="pri-input" data-bind="pri" data-i="${i}" value="${esc(p.text)}" placeholder="${i === 0 ? '오늘 가장 중요한 일' : ''}" autocomplete="off" enterkeyhint="next">
          ${marksHTML(k, i, p)}
        </li>`).join('')}
      </ol>
      ${showAll ? '' : `<button class="more-pri" data-act="pri-more">${I.plus} 6~10번 칸 펼치기</button>`}
      <h3 class="label">그 밖의 할 일</h3>
      <ul class="task-list">
        ${d.tasks.map(taskRowHTML).join('')}
        <li class="task new"><form data-form="task-new" data-date="${k}"><input class="task-input" name="t" placeholder="+ 할 일 추가 (Enter)" autocomplete="off" enterkeyhint="done"></form><span class="chk-cell"></span></li>
        ${'<li class="task filler" aria-hidden="true"><span></span><span class="chk-cell"></span></li>'.repeat(Math.max(0, 5 - d.tasks.length))}
      </ul>
    </section>
    <section class="col col-memo">
      <h3 class="label">메모<small>글 · 사진 · 지난 메모까지 이어서</small></h3>
      ${memoHTML(k, { feed: true })}
    </section>
    <section class="col col-schedule">
      <h3 class="label">시간표<button class="mini" data-act="new-event" data-date="${k}">${I.plus}일정</button></h3>
      ${allDayHTML(k)}
      ${timeGridHTML([k])}
      <p class="hint">빈 칸을 누르면 바로 적혀요 · ${isPhone() ? '일정을 꾹 누르면 옮길 수 있어요' : '일정은 끌어서 옮기고, 아래 끝을 당겨 길이 조절'}</p>
    </section>
  </div>`;
}

// 우선순위 오른쪽: ✓ 했음 / ✗ 못함
function marksHTML(k, i, p) {
  const off = p.text ? '' : 'disabled';
  return `<span class="marks">
    <button class="mk ok ${p.done ? 'on' : ''}" data-act="pri-mark" data-v="done" data-i="${i}" data-date="${k}" ${off} aria-label="했어요" title="했어요">${I.check}</button>
    <button class="mk no ${p.missed ? 'on' : ''}" data-act="pri-mark" data-v="miss" data-i="${i}" data-date="${k}" ${off} aria-label="못 했어요" title="못 했어요">${I.x}</button>
  </span>`;
}

function priSummary(d) {
  const pr = d.priorities.filter((p) => p.text);
  if (!pr.length) return '0/0';
  const done = pr.filter((p) => p.done).length;
  const miss = pr.filter((p) => p.missed).length;
  return `${done}/${pr.length} 완료${miss ? ` · ${miss} 못함` : ''}`;
}

const taskRowHTML = (t) => `<li class="task ${t.done ? 'done' : ''}">
  <input class="task-input" data-bind="task" data-id="${t.id}" value="${esc(t.text)}" autocomplete="off" enterkeyhint="next">
  <button class="x" data-act="task-del" data-id="${t.id}" aria-label="지우기">${I.x}</button>
  <span class="chk-cell"><button class="chk sq ${t.done ? 'on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="완료">${I.check}</button></span>
</li>`;

function bannersHTML(k, d) {
  let h = '';
  if (deferredInstall && !localStorage.getItem('installDismissed')) {
    h += `<div class="banner">${I.down}<span class="grow">홈 화면에 <b>앱으로 설치</b></span>
      <button class="btn sm primary" data-act="install">설치</button>
      <button class="icon-btn sm" data-act="install-dismiss" aria-label="닫기">${I.x}</button></div>`;
  }
  const items = k === todayKey() && !d.carried && !d.carryDismissed ? carryItems(k) : [];
  if (items.length) {
    h += `<div class="banner">${I.repeat}<span class="grow">어제 못 끝낸 일 <b>${items.length}개</b></span>
      <button class="btn sm primary" data-act="carry">오늘로 가져오기</button>
      <button class="icon-btn sm" data-act="carry-dismiss" aria-label="닫기">${I.x}</button></div>`;
  }
  return h;
}

function carryItems(k) {
  const y = store.days.get(addDays(k, -1));
  if (!y) return [];
  const t = store.day(k);
  const have = new Set([...t.priorities.map((p) => p.text), ...t.tasks.map((x) => x.text)].filter(Boolean));
  return [
    ...y.priorities.filter((p) => p.text && !p.done).map((p) => p.text),
    ...y.tasks.filter((x) => x.text && !x.done).map((x) => x.text),
  ].filter((x) => !have.has(x));
}

function allDayHTML(k) {
  const ad = store.eventsOn(k).filter((e) => e.allDay);
  if (!ad.length) return '';
  return `<div class="allday">${ad.map((e) => `<button class="chip-ev c-${e.color}" data-act="edit-event" data-id="${e.id}" data-date="${k}">${esc(e.title) || '(제목 없음)'}</button>`).join('')}</div>`;
}

/* 시간표 격자 (오늘 화면 1칸 / 주간 7칸 공용) */
function layoutDay(evs) {
  const items = evs
    .map((ev) => {
      const s = toMin(ev.start);
      return { ev, s, e: Math.max(toMin(ev.end), s + 15) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const out = [];
  let cluster = [];
  let end = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((x) => x <= it.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.e;
      it.col = c;
    }
    for (const it of cluster) { it.ncol = cols.length; out.push(it); }
    cluster = [];
  };
  for (const it of items) {
    if (cluster.length && it.s >= end) { flush(); end = -1; }
    cluster.push(it);
    end = Math.max(end, it.e);
  }
  if (cluster.length) flush();
  return out;
}

function timeGridHTML(dates) {
  const today = todayKey();
  const labels = Array.from({ length: H1 - H0 }, (_, i) => `<div class="tg-h"><span>${pad(H0 + i)}</span></div>`).join('');
  const cols = dates.map((k) => {
    const blocks = layoutDay(store.eventsOn(k).filter((e) => !e.allDay)).map((it) => evBlockHTML(it, k)).join('');
    let now = '';
    if (k === today) {
      const m = nowMin();
      now = `<div class="now-line" style="top:${pctOf(clamp(m, H0 * 60, H1 * 60))}" ${m < H0 * 60 ? 'hidden' : ''}></div>`;
    }
    return `<div class="tg-col ${k === today ? 'is-today' : ''}" data-date="${k}">${blocks}${now}</div>`;
  }).join('');
  return `<div class="tg" style="--cols:${dates.length};--hours:${H1 - H0}"><div class="tg-labels">${labels}</div>${cols}</div>`;
}

function evBlockHTML(it, k) {
  const e = it.ev;
  const s = clamp(it.s, H0 * 60, H1 * 60 - 15);
  const en = clamp(it.e, s + 15, H1 * 60);
  const short = en - s < 45;
  const l = (it.col / it.ncol) * 100;
  const w = 100 / it.ncol;
  return `<div class="ev c-${e.color} ${short ? 'short' : ''}" data-id="${e.id}" data-date="${k}"
    style="top:${pctOf(s)};height:${pctLen(en - s)};left:calc(${l}% + 2px);width:calc(${w}% - 4px)">
    <div class="ev-t">${e.start}${short ? '' : `–${e.end}`}${e.repeat !== 'none' ? ' ↻' : ''}</div>
    <div class="ev-title">${esc(e.title) || '(제목 없음)'}</div><i class="ev-resize"></i></div>`;
}

/* 메모 (그때그때 적는 곳) — feed: 오늘 메모 아래로 지난 메모까지 이어서 보여 줌 */
function memoHTML(k, { feed = false } = {}) {
  const d = store.day(k);
  const notes = [...d.notes].sort((a, b) => b.at - a.at);
  const list = `<ul class="notes">${notes.map((n) => noteHTML(k, n)).join('') || '<li class="empty">아직 메모가 없어요</li>'}</ul>`;
  return `<div class="memo-box">
    <textarea class="memo-input" data-memo="${k}" rows="2" placeholder="생각난 걸 바로 적어 두세요">${esc(getDraft(k))}</textarea>
    <div class="memo-tools">
      <button class="tool phone-only" data-act="photo" data-src="cam" data-date="${k}">${I.cam}<span>찍기</span></button>
      <button class="tool" data-act="photo" data-src="pick" data-date="${k}">${I.img}<span>사진</span></button>
      <span class="grow"></span>
      <span class="hint pc-only">Ctrl+Enter 저장</span>
      <button class="btn sm primary" data-act="memo-save" data-date="${k}">저장</button>
    </div>
  </div>
  ${feed ? `<div class="memo-feed" data-keep-scroll="memo-${k}">${list}${pastNotesHTML(k)}</div>` : list}`;
}

function pastNotesHTML(k) {
  const days = [...store.days.values()]
    .filter((d) => d.date < k && d.notes.length)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!days.length) return '';
  const shown = days.slice(0, S.memoDays);
  return `<div class="past">
    <div class="past-head"><span>지난 메모</span></div>
    ${shown.map((d) => `<section class="past-day">
      <button class="past-date" data-act="open-day" data-date="${d.date}">${md(d.date)} (${WD[wdIdx(d.date)]})<span>${relLabel(d.date)}</span></button>
      <ul class="notes">${[...d.notes].sort((a, b) => b.at - a.at).map((n) => noteHTML(d.date, n)).join('')}</ul>
    </section>`).join('')}
    ${days.length > shown.length ? `<button class="btn wide" data-act="memo-more">지난 메모 더 보기 (${days.length - shown.length}일)</button>` : ''}
  </div>`;
}

function photosHTML(k, n) {
  if (!n.photos.length) return '';
  return `<div class="ph-grid">${n.photos.map((pid) => `<button class="ph" data-act="photo-open" data-id="${pid}" data-date="${k}" data-note="${n.id}"><img data-photo="${pid}" alt=""></button>`).join('')}</div>`;
}

function noteHTML(k, n) {
  if (S.editingNote && S.editingNote.id === n.id) {
    return `<li class="note editing">
      <textarea class="note-edit" data-note-edit rows="3">${esc(n.text)}</textarea>
      <div class="row">
        <button class="btn sm danger-text" data-act="note-del" data-date="${k}" data-id="${n.id}">${I.trash}지우기</button>
        <button class="tool" data-act="photo" data-src="pick" data-date="${k}" data-note="${n.id}">${I.img}<span>사진 더하기</span></button>
        <span class="grow"></span>
        <button class="btn sm" data-act="note-cancel">취소</button>
        <button class="btn sm primary" data-act="note-update" data-date="${k}" data-id="${n.id}">저장</button>
      </div>${photosHTML(k, n)}</li>`;
  }
  return `<li class="note">
    <div class="note-meta"><time>${hhmm(n.at)}</time><button class="mini ghost" data-act="note-edit" data-date="${k}" data-id="${n.id}">수정</button></div>
    ${n.text ? `<div class="note-text">${richText(n.text)}</div>` : ''}
    ${photosHTML(k, n)}</li>`;
}

/* ---------------- 캘린더 ---------------- */
function calendarHTML() {
  const c = S.cal;
  const week = c.mode === 'week';
  let title;
  if (week) {
    const ds = parseKey(startOfWeek(c.anchor));
    const de = parseKey(addDays(startOfWeek(c.anchor), 6));
    title = `${ds.getFullYear()}년 ${ds.getMonth() + 1}월 ${ds.getDate()}일 – ${ds.getMonth() !== de.getMonth() ? `${de.getMonth() + 1}월 ` : ''}${de.getDate()}일`;
  } else {
    const a = parseKey(c.anchor);
    title = `${a.getFullYear()}년 ${a.getMonth() + 1}월`;
  }
  return `<section class="cal">
    <div class="cal-bar">
      <h2 class="cal-title">${title}</h2>
      <div class="cal-nav">
        <button class="icon-btn" data-act="cal-move" data-n="-1" aria-label="이전">${I.left}</button>
        <button class="btn sm" data-act="cal-today">오늘</button>
        <button class="icon-btn" data-act="cal-move" data-n="1" aria-label="다음">${I.right}</button>
      </div>
      <div class="seg mini">
        <button class="${week ? '' : 'on'}" data-act="cal-mode" data-mode="month">월</button>
        <button class="${week ? 'on' : ''}" data-act="cal-mode" data-mode="week">주</button>
      </div>
      <button class="btn primary" data-act="new-event" data-date="${c.sel}">${I.plus}<span>일정</span></button>
    </div>
    <div class="cal-body">
      <div class="cal-main">${week ? weekHTML() : monthHTML()}</div>
      <aside class="cal-side">${sideHTML(c.sel)}</aside>
    </div>
  </section>`;
}

function monthHTML() {
  const a = parseKey(S.cal.anchor);
  const y = a.getFullYear();
  const m = a.getMonth();
  const first = keyOf(new Date(y, m, 1));
  const last = keyOf(new Date(y, m + 1, 0));
  const gs = startOfWeek(first);
  const n = Math.ceil((dayDiff(gs, last) + 1) / 7) * 7;
  const today = todayKey();
  const cells = Array.from({ length: n }, (_, i) => {
    const k = addDays(gs, i);
    const dt = parseKey(k);
    const d = store.day(k);
    const evs = store.eventsOn(k);
    const pr = d.priorities.filter((p) => p.text);
    const done = pr.filter((p) => p.done).length;
    const miss = pr.filter((p) => p.missed).length;
    return `<div class="mo-cell ${dt.getMonth() !== m ? 'out' : ''} ${k === today ? 'today' : ''} ${k === S.cal.sel ? 'sel' : ''} ${wdClass(i % 7)}" data-act="pick-day" data-date="${k}">
      <div class="mo-top">
        <span class="mo-num">${dt.getDate()}</span>
        ${pr.length ? `<span class="mo-pri ${done === pr.length ? 'all' : ''}" title="우선순위 ${done}/${pr.length} 완료">✓ ${done}/${pr.length}</span>` : ''}
        <button class="mo-add" data-act="new-event" data-date="${k}" aria-label="${md(k)} 일정 추가" title="일정 추가">${I.plus}</button>
      </div>
      <div class="mo-evs">${evs.slice(0, 4).map((e) => `<div class="mo-ev c-${e.color}" draggable="true" data-act="edit-event" data-id="${e.id}" data-date="${k}">${e.allDay ? '' : `<b>${e.start}</b>`}${esc(e.title) || '(제목 없음)'}</div>`).join('')}${evs.length > 4 ? `<div class="mo-more">+${evs.length - 4}개 더</div>` : ''}</div>
      <div class="mo-dots">${evs.slice(0, 4).map((e) => `<i class="c-${e.color}"></i>`).join('')}${d.notes.length ? '<i class="memo"></i>' : ''}</div>
      <div class="mo-foot">
        ${d.notes.length ? `<span class="mo-memo">${I.memo}${d.notes.length}</span>` : ''}
        ${pr.length ? `<span class="mo-bar" title="우선순위 진행"><i style="width:${(done / pr.length) * 100}%"></i><i class="x" style="width:${(miss / pr.length) * 100}%"></i></span>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="mo">
    <div class="mo-wd">${WD.map((w, i) => `<span class="${wdClass(i)}">${w}</span>`).join('')}</div>
    <div class="mo-grid">${cells}</div>
  </div>`;
}

function weekHTML() {
  const start = startOfWeek(S.cal.anchor);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayKey();
  const head = dates.map((k, i) => `<button class="wk-d ${k === today ? 'today' : ''} ${k === S.cal.sel ? 'sel' : ''} ${wdClass(i)}" data-act="pick-day" data-date="${k}">
      <span class="wk-wd">${WD[i]}</span><span class="wk-dn">${parseKey(k).getDate()}</span></button>`).join('');
  const top = dates.map((k) => {
    const d = store.day(k);
    const pr = d.priorities.filter((p) => p.text);
    const ad = store.eventsOn(k).filter((e) => e.allDay);
    return `<div class="wk-top-cell ${k === S.cal.sel ? 'sel' : ''}" data-act="pick-day" data-date="${k}">
      ${ad.map((e) => `<div class="chip-ev c-${e.color}" data-act="edit-event" data-id="${e.id}" data-date="${k}">${esc(e.title)}</div>`).join('')}
      ${pr.slice(0, 4).map((p) => `<div class="wk-pri ${p.done ? 'done' : ''} ${p.missed ? 'miss' : ''}">${esc(p.text)}</div>`).join('')}
      ${pr.length > 4 ? `<div class="wk-more">+${pr.length - 4}</div>` : ''}</div>`;
  }).join('');
  return `<div class="wk">
    <div class="wk-head"><div></div>${head}</div>
    <div class="wk-top"><div class="wk-top-lab">할 일</div>${top}</div>
    <div class="wk-scroll" data-keep-scroll="wk">${timeGridHTML(dates)}</div>
  </div>`;
}

function sideHTML(k) {
  const d = store.day(k);
  const evs = store.eventsOn(k);
  const pr = d.priorities.map((p, i) => ({ ...p, i })).filter((p) => p.text);
  return `<div class="side-head">
      <div><div class="side-date">${md(k)} ${WD_FULL[wdIdx(k)]}</div><div class="side-sub">${relLabel(k)}</div></div>
      <button class="btn sm" data-act="open-day" data-date="${k}">플래너 열기${I.right}</button>
    </div>
    ${d.goal ? `<div class="side-goal">${esc(d.goal)}</div>` : ''}
    <div class="side-sec">
      <h3 class="label">일정<button class="mini" data-act="new-event" data-date="${k}">${I.plus}추가</button></h3>
      ${evs.length ? `<ul class="side-evs">${evs.map((e) => `<li class="c-${e.color}" data-act="edit-event" data-id="${e.id}" data-date="${k}">
        <span class="t">${e.allDay ? '하루 종일' : `${e.start}–${e.end}`}</span><span class="n">${esc(e.title) || '(제목 없음)'}</span>${e.repeat !== 'none' ? '<span class="r">↻</span>' : ''}</li>`).join('')}</ul>` : '<p class="empty">일정이 없어요</p>'}
    </div>
    <div class="side-sec">
      <h3 class="label">우선순위<small>${priSummary(d)}</small><span class="pri-legend"><i>했음</i><i>못함</i></span></h3>
      ${pr.length ? `<ul class="side-pri">${pr.map((p) => `<li class="${p.done ? 'done' : ''} ${p.missed ? 'miss' : ''}">
        <span class="t">${esc(p.text)}</span>${marksHTML(k, p.i, p)}</li>`).join('')}</ul>`
        : `<p class="empty">아직 정하지 않았어요 · <button class="link" data-act="open-day" data-date="${k}">플래너에서 적기</button></p>`}
    </div>
    <div class="side-sec">
      <h3 class="label">메모</h3>
      ${memoHTML(k)}
    </div>`;
}

/* ---------------- 기록 (지난 날 모아 보기) ---------------- */
function recordsHTML() {
  const chips = [['all', '전체'], ['memo', '메모'], ['photo', '사진'], ['done', '완료한 일']];
  return `<section class="rec">
    <div class="rec-bar">
      <label class="search">${I.search}<input type="search" data-bind="rec-q" value="${esc(S.rec.q)}" placeholder="메모·할 일 검색" autocomplete="off"></label>
      <div class="chips">${chips.map(([f, l]) => `<button class="chip ${S.rec.filter === f ? 'on' : ''}" data-act="rec-filter" data-f="${f}">${l}</button>`).join('')}</div>
    </div>
    <div id="recList">${recListHTML()}</div>
  </section>`;
}

const dayText = (d) => [d.goal, ...d.priorities.map((p) => p.text), ...d.tasks.map((t) => t.text), ...d.notes.map((n) => n.text)].join('\n').toLowerCase();

function recListHTML() {
  const q = S.rec.q.trim().toLowerCase();
  const f = S.rec.filter;
  let days = [...store.days.values()].filter(hasContent);
  if (f === 'memo') days = days.filter((d) => d.notes.some((n) => n.text));
  if (f === 'photo') days = days.filter((d) => d.notes.some((n) => n.photos.length));
  if (f === 'done') days = days.filter((d) => d.priorities.some((p) => p.text && p.done) || d.tasks.some((t) => t.text && t.done));
  if (q) days = days.filter((d) => dayText(d).includes(q));
  days.sort((a, b) => b.date.localeCompare(a.date));
  if (!days.length) {
    return `<div class="empty-big">${q ? '검색 결과가 없어요' : '아직 기록이 없어요.<br>오늘 페이지에 적으면 여기에 날짜별로 쌓여요.'}</div>`;
  }
  const shown = days.slice(0, S.rec.limit);
  return shown.map((d) => recCardHTML(d, q, f)).join('') +
    (days.length > shown.length ? `<button class="btn wide" data-act="rec-more">더 보기 (${days.length - shown.length}일)</button>` : '');
}

function hl(text, q, rich) {
  const h = rich ? richText(text) : esc(text);
  if (!q) return h;
  const re = new RegExp(escRe(esc(q)), 'gi');
  return h.replace(/(<[^>]+>)|([^<]+)/g, (m, tag, txt) => (tag ? tag : txt.replace(re, '<mark>$&</mark>')));
}

function recCardHTML(d, q, f) {
  const k = d.date;
  const pr = d.priorities.filter((p) => p.text);
  const done = pr.filter((p) => p.done).length;
  const notes = [...d.notes]
    .sort((a, b) => a.at - b.at)
    .filter((n) => (f === 'photo' ? n.photos.length : true))
    .filter((n) => !q || n.text.toLowerCase().includes(q));
  const tasks = d.tasks.filter((t) => t.text && (f === 'done' ? t.done : true));
  return `<article class="rec-card">
    <div class="rec-head">
      <button class="rec-date" data-act="open-day" data-date="${k}">${md(k)} (${WD[wdIdx(k)]})</button>
      <span class="muted small">${parseKey(k).getFullYear()} · ${relLabel(k)}</span>
      ${pr.length ? `<span class="rec-stat">✓ ${done}/${pr.length}</span>` : ''}
    </div>
    ${d.goal && f !== 'photo' ? `<p class="rec-goal">${hl(d.goal, q)}</p>` : ''}
    ${pr.length && f !== 'photo' ? `<ul class="rec-pri">${pr.filter((p) => (f === 'done' ? p.done : true)).map((p) => `<li class="${p.done ? 'done' : ''} ${p.missed ? 'miss' : ''}">${hl(p.text, q)}</li>`).join('')}</ul>` : ''}
    ${tasks.length && f !== 'photo' && f !== 'memo' ? `<ul class="rec-pri rec-tasks">${tasks.map((t) => `<li class="${t.done ? 'done' : ''}">${hl(t.text, q)}</li>`).join('')}</ul>` : ''}
    ${notes.length && f !== 'done' ? `<ul class="notes rec-notes">${notes.map((n) => `<li class="note">
      <div class="note-meta"><time>${hhmm(n.at)}</time></div>
      ${n.text ? `<div class="note-text">${hl(n.text, q, true)}</div>` : ''}${photosHTML(k, n)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

/* ---------------- 창(모달) ---------------- */
function openModal(html, { cls = '' } = {}) {
  if (modal) { modal.el.remove(); modal = null; }
  else history.pushState({ modal: 1 }, '');
  const wrap = document.createElement('div');
  wrap.className = `modal ${cls}`;
  wrap.innerHTML = `<div class="modal-bg" data-act="modal-close"></div><div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  document.getElementById('overlay').appendChild(wrap);
  modal = { el: wrap };
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => wrap.classList.add('show'));
  return wrap;
}

function closeModal(fromPop = false) {
  if (!modal) return;
  modal.el.remove();
  modal = null;
  document.body.classList.remove('modal-open');
  if (!fromPop) { skipPop = true; history.back(); }
}

/* 일정 편집 */
function defaultStart(k) {
  if (k === todayKey()) return fromMin(Math.min(Math.ceil((nowMin() + 1) / 60) * 60, 23 * 60));
  return '09:00';
}

function openEventEditor(o = {}) {
  const ex = o.id ? store.events.get(o.id) : null;
  const occ = o.date || ex?.date || S.date;
  const ev = ex ? { ...ex } : {
    title: o.title || '', date: occ, start: o.start || defaultStart(occ), end: o.end || '',
    allDay: false, repeat: 'none', until: '', color: S.lastColor, note: '',
  };
  if (!ev.end) ev.end = fromMin(Math.min(toMin(ev.start) + 60, 1440));
  const endShown = ev.end === '24:00' ? '00:00' : ev.end;
  const wl = (k) => `매주 ${WD[wdIdx(k)]}요일`;
  const m = openModal(`<form class="ed" data-form="event">
    <div class="ed-head"><h3>${ex ? '일정 수정' : '새 일정'}</h3><button type="button" class="icon-btn" data-act="modal-close" aria-label="닫기">${I.x}</button></div>
    <input class="ed-title" name="title" value="${esc(ev.title)}" placeholder="무엇을 하나요?" autocomplete="off" enterkeyhint="done">
    <div class="ed-row"><label>날짜</label><input type="date" name="date" value="${ev.date}" required></div>
    <div class="ed-row"><label>시간</label>
      <div class="ed-times"><input type="time" name="start" value="${ev.start}" step="300"><span>–</span><input type="time" name="end" value="${endShown}" step="300"></div>
      <label class="ck"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}>하루 종일</label>
    </div>
    <div class="ed-row"><label>반복</label>
      <select name="repeat">
        <option value="none">반복 안 함</option><option value="daily">매일</option>
        <option value="weekdays">평일 (월–금)</option><option value="weekly">${wl(ev.date)}</option>
      </select>
    </div>
    <div class="ed-row ed-until" ${ev.repeat === 'none' ? 'hidden' : ''}><label>반복 끝</label><input type="date" name="until" value="${ev.until}"><small class="muted">비우면 계속 반복</small></div>
    <div class="ed-row"><label>색</label><div class="swatches">${COLORS.map((c) => `<label class="sw c-${c}"><input type="radio" name="color" value="${c}" ${ev.color === c ? 'checked' : ''}><i></i></label>`).join('')}</div></div>
    <textarea name="note" rows="2" placeholder="메모 (선택)">${esc(ev.note)}</textarea>
    ${ex && ex.repeat !== 'none' ? '<p class="muted small">반복 일정은 고치면 반복 전체가 함께 바뀌어요.</p>' : ''}
    <div class="ed-foot">
      ${ex ? `<button type="button" class="btn danger-text" data-act="ev-del" data-id="${ex.id}" data-date="${occ}">${I.trash}지우기</button>` : ''}
      <span class="grow"></span>
      <button type="button" class="btn" data-act="modal-close">취소</button>
      <button type="submit" class="btn primary">저장</button>
    </div>
  </form>`, { cls: 'sheet' });

  const f = m.querySelector('form');
  f._ex = ex;
  f.repeat.value = ev.repeat;
  const syncTimes = () => { f.start.disabled = f.end.disabled = f.allDay.checked; };
  syncTimes();
  f.allDay.addEventListener('change', syncTimes);
  f.repeat.addEventListener('change', () => { m.querySelector('.ed-until').hidden = f.repeat.value === 'none'; });
  f.date.addEventListener('change', () => { if (f.date.value) f.repeat.querySelector('[value="weekly"]').textContent = wl(f.date.value); });
  if (!ex && !isPhone()) f.title.focus();
  else if (!ex) setTimeout(() => f.title.focus(), 60);
}

function saveEventForm(f) {
  const title = f.title.value.trim();
  if (!title) { f.title.focus(); toast('무엇을 하는지 적어 주세요'); return; }
  const allDay = f.allDay.checked;
  let s = toMin(f.start.value || '09:00');
  let e = toMin(f.end.value || '10:00');
  if (e === 0 && s > 0) e = 1440;
  if (e <= s) e = Math.min(s + 60, 1440);
  if (s >= 1440) s = 1380;
  const repeat = f.repeat.value;
  const color = f.querySelector('[name="color"]:checked')?.value || 'blue';
  const ev = {
    ...(f._ex || {}),
    title,
    date: f.date.value || S.date,
    start: fromMin(s),
    end: fromMin(e),
    allDay,
    repeat,
    until: repeat === 'none' ? '' : f.until.value,
    color,
    note: f.note.value.trim(),
  };
  store.saveEvent(ev);
  S.lastColor = color;
  localStorage.setItem('lastColor', color);
  closeModal();
  render();
  toast(f._ex ? '일정을 고쳤어요' : '일정을 추가했어요');
}

function deleteEventFlow(id, occ) {
  const ev = store.events.get(id);
  if (!ev) return;
  if (ev.repeat !== 'none') {
    openModal(`<div class="confirm">
      <h3>반복 일정 지우기</h3><p class="muted">${esc(ev.title)}</p>
      <div class="stack">
        <button class="btn" data-act="ev-del-one" data-id="${id}" data-date="${occ}">${md(occ)} 하루만 지우기</button>
        <button class="btn danger-text" data-act="ev-del-all" data-id="${id}">반복 전체 지우기</button>
        <button class="btn" data-act="modal-close">취소</button>
      </div></div>`, { cls: 'sheet' });
  } else if (confirm(`'${ev.title}' 일정을 지울까요?`)) {
    store.deleteEvent(id);
    closeModal();
    render();
    toast('일정을 지웠어요');
  }
}

/* 설정 */
function openSettings() {
  const s = store.status;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let sync;
  if (s.mode === 'cloud' && s.user) {
    sync = `<p class="ok-line">${I.check}<b>${esc(s.user.email)}</b></p>
      <p class="muted">이 구글 계정으로 핸드폰·노트북·패드에서 로그인하면 같은 내용이 바로 보여요.</p>
      ${s.error ? `<p class="err">문제: ${esc(s.error)}</p>` : ''}
      <button class="btn" data-act="sign-out">로그아웃</button>`;
  } else if (s.hasConfig) {
    sync = `<p>구글 계정으로 로그인하면 <b>핸드폰·노트북·패드가 실시간으로 연결</b>돼요.</p>
      <button class="btn primary" data-act="sign-in">Google 계정으로 로그인</button>
      ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}`;
  } else {
    sync = `<p>지금은 <b>이 기기에만</b> 저장돼요. 인터넷 없이도 써져요.</p>
      <p class="muted">핸드폰·노트북 연동은 Firebase(무료)를 한 번 연결하면 켜져요. <a href="${SETUP_URL}" target="_blank" rel="noopener">연결 방법 보기</a></p>`;
  }
  const install = standalone
    ? `<p class="ok-line">${I.check}앱으로 실행 중이에요</p>`
    : deferredInstall
      ? '<button class="btn primary" data-act="install">홈 화면에 앱 설치</button>'
      : `<p class="muted">핸드폰: 크롬 메뉴(⋮) → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b><br>노트북: 크롬·엣지 주소창 오른쪽의 <b>설치</b> 아이콘</p>`;
  openModal(`<div class="st">
    <div class="ed-head"><h3>설정</h3><button class="icon-btn" data-act="modal-close" aria-label="닫기">${I.x}</button></div>
    <section><h4>기기 연동</h4>${sync}</section>
    <section><h4>앱 설치</h4>${install}</section>
    <section><h4>백업</h4>
      <p class="muted">모든 기록(사진 포함)을 파일 하나로 내려받아 따로 보관할 수 있어요.</p>
      <div class="row"><button class="btn" data-act="export">${I.down}백업 내려받기</button><button class="btn" data-act="import">백업 불러오기</button></div>
    </section>
    <section class="muted small">데일리 플래너 v${esc(runningVersion || '-')} · 새 버전이 나오면 앱을 열 때 자동으로 바뀌어요</section>
  </div>`, { cls: 'sheet' });
}

/* 사진 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let max = 1600;
      let q = 0.82;
      let out = '';
      for (let i = 0; i < 6; i++) {
        const sc = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * sc));
        const h = Math.max(1, Math.round(img.naturalHeight * sc));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        out = c.toDataURL('image/jpeg', q);
        if (out.length < 800000) break; // 클라우드 한 칸(1MB) 안에 들어가게
        max *= 0.8;
        q = Math.max(0.5, q - 0.07);
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  });
}

async function handleFiles(files) {
  const t = S.photoTarget;
  if (!t || !files.length) return;
  toast('사진 저장 중…');
  const ids = [];
  for (const file of files) {
    try {
      ids.push(await store.addPhoto(t.date, await compressImage(file)));
    } catch (e) {
      console.error(e);
      toast('이 사진은 열 수 없어요 (HEIC 형식이면 JPG로 바꿔 주세요)');
    }
  }
  if (!ids.length) return;
  if (t.noteId) {
    store.editDay(t.date, (d) => { const n = d.notes.find((x) => x.id === t.noteId); if (n) n.photos.push(...ids); });
  } else {
    const ta = $view.querySelector(`[data-memo="${t.date}"]`);
    const text = (ta ? ta.value : getDraft(t.date)).trim();
    store.addNote(t.date, text, ids);
    setDraft(t.date, '');
  }
  render();
  toast(`사진 ${ids.length}장을 저장했어요`);
}

async function openPhoto(id, k, noteId) {
  const data = await store.getPhoto(id);
  if (!data) { toast('사진을 불러오지 못했어요 (인터넷 확인)'); return; }
  openModal(`<div class="lb"><img src="${data}" alt="">
    <div class="lb-bar">
      <a class="btn" href="${data}" download="planner-${k}.jpg">${I.down}내려받기</a>
      <button class="btn danger-text" data-act="photo-del" data-id="${id}" data-date="${k}" data-note="${noteId}">${I.trash}지우기</button>
      <span class="grow"></span>
      <button class="btn" data-act="modal-close">닫기</button>
    </div></div>`, { cls: 'lb-modal' });
}

function deletePhoto(pid, k, noteId) {
  if (!confirm('이 사진을 지울까요?')) return;
  store.editDay(k, (d) => {
    const n = d.notes.find((x) => x.id === noteId);
    if (!n) return;
    n.photos = n.photos.filter((x) => x !== pid);
    if (!n.text && !n.photos.length) d.notes = d.notes.filter((x) => x !== n);
  });
  store.deletePhoto(pid);
  closeModal();
  render();
}

/* ---------------- 동작 ---------------- */
function viewFromHash() {
  const h = location.hash.replace('#', '');
  return ['calendar', 'records'].includes(h) ? h : 'today';
}

function go(view) {
  if (view === S.view) {
    if (view === 'today' && S.date !== todayKey()) { S.date = todayKey(); resetDayUI(); }
    render({ resetScroll: true });
    return;
  }
  if (S.view === 'today') history.pushState({ tab: 1 }, '', `#${view}`);
  else if (view === 'today') {
    if (history.state?.tab) { history.back(); return; } // popstate가 그려 줌
    history.replaceState(null, '', location.pathname + location.search);
  } else history.replaceState({ tab: 1 }, '', `#${view}`);
  S.view = view;
  if (view === 'calendar') S.cal.scrolled = false;
  render({ resetScroll: true });
}

function openDay(k) {
  S.date = k;
  resetDayUI();
  if (S.view === 'today') render({ resetScroll: true });
  else go('today');
}

function resetDayUI() {
  S.showAllPri = false;
  S.editingNote = null;
}

function animate(n) {
  $view.classList.remove('slide-l', 'slide-r');
  void $view.offsetWidth;
  $view.classList.add(n > 0 ? 'slide-l' : 'slide-r');
}

function changeDay(n) {
  S.date = addDays(S.date, n);
  resetDayUI();
  render();
  animate(n);
}

function calMove(n) {
  const c = S.cal;
  if (c.mode === 'month') {
    c.anchor = addMonths(c.anchor, n);
    const t = todayKey();
    c.sel = t.slice(0, 7) === c.anchor.slice(0, 7) ? t : c.anchor;
  } else {
    c.anchor = addDays(c.anchor, 7 * n);
    c.sel = addDays(c.sel, 7 * n);
  }
  render();
}

function updateCounts() {
  if (S.view !== 'today') return;
  const d = store.day(S.date);
  const pr = d.priorities.filter((p) => p.text);
  const all = [...pr, ...d.tasks.filter((t) => t.text)];
  const set = (sel, txt) => { const el = $view.querySelector(sel); if (el) el.textContent = txt; };
  set('[data-count="pri"]', priSummary(d));
  set('[data-count="tasks"]', `${all.filter((x) => x.done).length}/${all.length}`);
  set('[data-count="memo"]', String(d.notes.length));
  $view.querySelector(`.ws-day[data-date="${S.date}"] .ws-dot`)?.classList.toggle('off', !dayHasAny(S.date));
}

function popCheck(el) {
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
}

// ✓(했음) / ✗(못함) — 같은 버튼을 다시 누르면 표시 지움
function markPri(a, k) {
  const i = +a.dataset.i;
  const v = a.dataset.v;
  let st = { done: false, missed: false };
  store.editDay(k, (d) => {
    const p = d.priorities[i];
    if (!p.text) return;
    if (v === 'done') { p.done = !p.done; if (p.done) p.missed = false; }
    else { p.missed = !p.missed; if (p.missed) p.done = false; }
    st = { done: p.done, missed: p.missed };
  });
  const li = a.closest('.pri');
  if (S.view === 'today' && li) {
    li.classList.toggle('done', st.done);
    li.classList.toggle('miss', st.missed);
    li.querySelector('.mk.ok').classList.toggle('on', st.done);
    li.querySelector('.mk.no').classList.toggle('on', st.missed);
    if (st.done || st.missed) popCheck(a);
    updateCounts();
  } else render();
}

function toggleTask(a, k) {
  const id = a.dataset.id;
  let on = false;
  store.editDay(k, (d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (t) { t.done = !t.done; on = t.done; }
  });
  a.classList.toggle('on', on);
  a.closest('.task')?.classList.toggle('done', on);
  if (on) popCheck(a);
  updateCounts();
}

function addTask(form) {
  const inp = form.querySelector('input');
  const v = inp.value.trim();
  if (!v) return;
  const k = form.dataset.date;
  const t = { id: uid(), text: v, done: false };
  store.editDay(k, (d) => d.tasks.push(t));
  inp.value = '';
  const li = form.closest('li');
  li.insertAdjacentHTML('beforebegin', taskRowHTML(t));
  li.parentElement.querySelector('.task.filler')?.remove();
  updateCounts();
}

function carry(k) {
  const items = carryItems(k);
  store.editDay(k, (d) => {
    for (const text of items) {
      const slot = d.priorities.findIndex((p) => !p.text);
      if (slot >= 0) d.priorities[slot] = { text, done: false, missed: false };
      else d.tasks.push({ id: uid(), text, done: false });
    }
    d.carried = true;
  });
  render();
  toast(`${items.length}개를 오늘로 가져왔어요`);
}

function saveMemo(k) {
  const ta = $view.querySelector(`[data-memo="${k}"]`);
  const text = (ta ? ta.value : getDraft(k)).trim();
  if (!text) { focusEl(ta); return; }
  store.addNote(k, text);
  setDraft(k, '');
  render();
  if (!isPhone()) focusEl($view.querySelector(`[data-memo="${k}"]`));
  toast('메모를 저장했어요');
}

function updateNote(k, id) {
  const ta = $view.querySelector('[data-note-edit]');
  const text = ta ? ta.value.trim() : '';
  store.editDay(k, (d) => {
    const n = d.notes.find((x) => x.id === id);
    if (!n) return;
    n.text = text;
    if (!n.text && !n.photos.length) d.notes = d.notes.filter((x) => x !== n);
  });
  S.editingNote = null;
  render();
}

function deleteNote(k, id) {
  const n = store.day(k).notes.find((x) => x.id === id);
  n?.photos.forEach((pid) => store.deletePhoto(pid));
  store.editDay(k, (d) => { d.notes = d.notes.filter((x) => x.id !== id); });
  S.editingNote = null;
  render();
}

function scrollToNow() {
  requestAnimationFrame(() => {
    const col = $view.querySelector('.col-schedule .tg-col');
    if (!col) return;
    const m = S.date === todayKey() ? clamp(nowMin() - 60, H0 * 60, H1 * 60) : 8 * 60;
    const r = col.getBoundingClientRect();
    const y = window.scrollY + r.top + ((m - H0 * 60) / TOTAL) * r.height - 130;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  });
}

async function doInstall() {
  if (!deferredInstall) { openSettings(); return; }
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch { /* 무시 */ }
  deferredInstall = null;
  render();
}

async function signIn() {
  if (!store.cloud) { toast('연동 준비 중이에요. 잠시 후 다시 눌러 주세요'); return; }
  try {
    await store.cloud.signIn();
    closeModal();
    toast('로그인했어요 · 이제 모든 기기가 연결돼요');
  } catch (e) {
    console.error(e);
    toast(`로그인 실패: ${e.code || e.message}`);
  }
}

async function signOut() {
  if (!confirm('로그아웃할까요? (기록은 클라우드에 그대로 남아요)')) return;
  await store.cloud?.signOut();
  closeModal();
  toast('로그아웃했어요');
}

async function exportData() {
  toast('백업 파일 만드는 중…');
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `planner-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('백업 파일을 내려받았어요');
}

async function importData(file) {
  try {
    const n = await store.importAll(JSON.parse(await file.text()));
    closeModal();
    render();
    toast(`${n}일치 기록을 불러왔어요`);
  } catch (e) {
    toast(e.message || '불러오지 못했어요');
  }
}

function openFab() {
  openModal(`<div class="fab-sheet">
    <button data-act="fab-memo">${I.memo}<span>메모 쓰기</span></button>
    <button data-act="fab-cam">${I.cam}<span>사진 찍기</span></button>
    <button data-act="fab-event">${I.cal}<span>일정 추가</span></button>
    <button data-act="fab-task">${I.check}<span>할 일 추가</span></button>
  </div>`, { cls: 'sheet' });
}

function onClick(e) {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  const k = a.dataset.date || (S.view === 'calendar' ? S.cal.sel : S.date);
  switch (act) {
    case 'go': go(a.dataset.view); break;
    case 'settings': openSettings(); break;
    case 'day-move': changeDay(+a.dataset.n); break;
    case 'day-today': { const n = dayDiff(S.date, todayKey()); S.date = todayKey(); resetDayUI(); render(); animate(n); break; }
    case 'goto-day':
      if (a.dataset.date !== S.date) {
        const n = dayDiff(S.date, a.dataset.date);
        S.date = a.dataset.date;
        resetDayUI();
        render();
        animate(n);
      }
      break;
    case 'pane': S.pane = a.dataset.pane; render(); if (S.pane === 'schedule') scrollToNow(); break;
    case 'pri-more': S.showAllPri = true; render({ focus: '[data-bind="pri"][data-i="5"]' }); break;
    case 'pri-mark': markPri(a, k); break;
    case 'memo-more': S.memoDays += 14; render(); break;
    case 'task-toggle': toggleTask(a, k); break;
    case 'task-del': store.editDay(k, (d) => { d.tasks = d.tasks.filter((t) => t.id !== a.dataset.id); }); render(); break;
    case 'carry': carry(k); break;
    case 'carry-dismiss': store.editDay(k, (d) => { d.carryDismissed = true; }); render(); break;
    case 'install': doInstall(); break;
    case 'install-dismiss': localStorage.setItem('installDismissed', '1'); render(); break;
    case 'memo-save': saveMemo(k); break;
    case 'photo':
      S.photoTarget = { date: k, noteId: a.dataset.note || null };
      document.getElementById(a.dataset.src === 'cam' ? 'fileCam' : 'filePick').click();
      break;
    case 'photo-open': openPhoto(a.dataset.id, k, a.dataset.note); break;
    case 'photo-del': deletePhoto(a.dataset.id, k, a.dataset.note); break;
    case 'note-edit': S.editingNote = { date: k, id: a.dataset.id }; render({ focus: '[data-note-edit]' }); break;
    case 'note-cancel': S.editingNote = null; render(); break;
    case 'note-update': updateNote(k, a.dataset.id); break;
    case 'note-del': if (confirm('이 메모를 지울까요?')) deleteNote(k, a.dataset.id); break;
    case 'new-event': openEventEditor({ date: k }); break;
    case 'edit-event': openEventEditor({ id: a.dataset.id, date: a.dataset.date }); break;
    case 'ev-del': deleteEventFlow(a.dataset.id, a.dataset.date); break;
    case 'ev-del-one': store.skipOccurrence(a.dataset.id, a.dataset.date); closeModal(); render(); toast('그날 일정만 지웠어요'); break;
    case 'ev-del-all': store.deleteEvent(a.dataset.id); closeModal(); render(); toast('반복 일정을 모두 지웠어요'); break;
    case 'cal-move': calMove(+a.dataset.n); break;
    case 'cal-today': S.cal.anchor = S.cal.sel = todayKey(); S.cal.scrolled = false; render(); break;
    case 'cal-mode':
      S.cal.mode = a.dataset.mode;
      localStorage.setItem('calMode', S.cal.mode);
      S.cal.anchor = S.cal.sel;
      S.cal.scrolled = false;
      render();
      break;
    case 'pick-day': if (S.view === 'calendar') { S.cal.sel = a.dataset.date; render(); } break;
    case 'open-day': openDay(a.dataset.date); break;
    case 'rec-filter': S.rec.filter = a.dataset.f; S.rec.limit = 20; render(); break;
    case 'rec-more': S.rec.limit += 20; render(); break;
    case 'modal-close': closeModal(); break;
    case 'fab': openFab(); break;
    case 'fab-memo': closeModal(); S.pane = 'memo'; render(); focusEl($view.querySelector('[data-memo]')); break;
    case 'fab-cam': closeModal(); S.photoTarget = { date: S.date }; document.getElementById('fileCam').click(); break;
    case 'fab-event': openEventEditor({ date: S.date }); break;
    case 'fab-task': closeModal(); S.pane = 'tasks'; render(); focusEl($view.querySelector('[data-form="task-new"] input')); break;
    case 'sign-in': signIn(); break;
    case 'sign-out': signOut(); break;
    case 'export': exportData(); break;
    case 'import': document.getElementById('fileImport').click(); break;
    case 'slot-cancel': a.closest('.slot-input')?.remove(); break;
    case 'slot-more': slotMore(a.closest('.slot-input')); break;
    default: break;
  }
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.memo) { setDraft(el.dataset.memo, el.value); autoGrow(el); return; }
  if (el.matches('[data-note-edit]')) { autoGrow(el); return; }
  const b = el.dataset.bind;
  if (!b) return;
  const k = el.dataset.date || S.date;
  if (b === 'goal') store.editDay(k, (d) => { d.goal = el.value; });
  else if (b === 'pri') {
    const i = +el.dataset.i;
    const filled = !!el.value.trim();
    store.editDay(k, (d) => {
      d.priorities[i].text = el.value;
      if (!filled) { d.priorities[i].done = false; d.priorities[i].missed = false; }
    });
    const li = el.closest('.pri');
    li?.querySelectorAll('.mk').forEach((btn) => {
      btn.disabled = !filled;
      if (!filled) btn.classList.remove('on');
    });
    if (li && !filled) li.classList.remove('done', 'miss');
  } else if (b === 'task') {
    store.editDay(k, (d) => { const t = d.tasks.find((x) => x.id === el.dataset.id); if (t) t.text = el.value; });
  } else if (b === 'rec-q') {
    S.rec.q = el.value;
    S.rec.limit = 20;
    const list = document.getElementById('recList');
    if (list) { list.innerHTML = recListHTML(); hydratePhotos(list); }
    return;
  }
  updateCounts();
}

// Enter 키: 한글 입력 중(조합 중)에 누른 Enter도 한 번만 처리
function isEnterField(el) {
  return el.matches?.('[data-bind="goal"], [data-bind="pri"], [data-bind="task"], [data-form="task-new"] input, .slot-input input');
}

function doEnter(el) {
  if (!el.isConnected) return;
  const b = el.dataset.bind;
  if (el.closest('[data-form="task-new"]')) { addTask(el.closest('form')); return; }
  if (el.closest('.slot-input')) { createFromSlot(el.closest('.slot-input')); return; }
  if (b === 'goal') { focusEl($view.querySelector('[data-bind="pri"][data-i="0"]')); return; }
  if (b === 'task') { focusEl($view.querySelector('[data-form="task-new"] input')); return; }
  if (b === 'pri') {
    const i = +el.dataset.i;
    if (i >= 9) { focusEl($view.querySelector('[data-form="task-new"] input')); return; }
    const next = $view.querySelector(`[data-bind="pri"][data-i="${i + 1}"]`);
    if (next && next.offsetParent === null) {
      S.showAllPri = true;
      render({ focus: `[data-bind="pri"][data-i="${i + 1}"]` });
    } else focusEl(next);
  }
}

function onKeydown(e) {
  const el = e.target;
  if (e.key === 'Escape' && el.closest?.('.slot-input')) { el.closest('.slot-input').remove(); return; }
  if (e.key === 'Enter' && !e.shiftKey && isEnterField(el)) {
    if (e.isComposing || e.keyCode === 229) {
      // 한글 조합 중 Enter: 조합이 끝나면 처리 (조합 끝 신호가 안 오는 키보드는 잠시 뒤 처리)
      composeEnter = el;
      clearTimeout(composeTimer);
      composeTimer = setTimeout(() => {
        if (composeEnter !== el) return;
        composeEnter = null;
        composeDoneAt = Date.now();
        doEnter(el);
      }, 250);
      return;
    }
    e.preventDefault();
    if (Date.now() - composeDoneAt < 120) return; // 조합 끝나며 이미 처리됨
    doEnter(el);
    return;
  }
  if (e.isComposing) return;
  const b = el.dataset?.bind;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    if (el.dataset?.memo) { e.preventDefault(); saveMemo(el.dataset.memo); }
    else if (el.matches?.('[data-note-edit]') && S.editingNote) { e.preventDefault(); updateNote(S.editingNote.date, S.editingNote.id); }
  } else if (e.key === 'Backspace' && b === 'task' && !el.value) {
    e.preventDefault();
    const k = el.dataset.date || S.date;
    const id = el.dataset.id;
    const li = el.closest('.task');
    const prev = li.previousElementSibling?.querySelector('.task-input');
    store.editDay(k, (d) => { d.tasks = d.tasks.filter((t) => t.id !== id); });
    li.remove();
    updateCounts();
    focusEl(prev || $view.querySelector('[data-form="task-new"] input'));
  }
}

function onCompositionEnd(e) {
  if (composeEnter && composeEnter === e.target) {
    const el = composeEnter;
    composeEnter = null;
    clearTimeout(composeTimer);
    composeDoneAt = Date.now();
    setTimeout(() => doEnter(el), 0);
  }
}

function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  if (f.dataset.form === 'task-new') addTask(f);
  else if (f.classList.contains('slot-input')) createFromSlot(f);
  else if (f.dataset.form === 'event') saveEventForm(f);
}

/* 시간표: 빈 칸 눌러 적기 / 끌어서 옮기기 / 길이 조절 */
function minuteAt(col, y) {
  const r = col.getBoundingClientRect();
  return H0 * 60 + ((y - r.top) / r.height) * TOTAL;
}

function openSlotInput(col, s, e) {
  closeSlotInputs();
  const f = document.createElement('form');
  f.className = 'slot-input';
  f.dataset.date = col.dataset.date;
  f.dataset.s = s;
  f.dataset.e = e;
  f.style.top = pctOf(s);
  f.style.height = pctLen(e - s);
  f.innerHTML = `<div class="si-time">${fromMin(s)} – ${fromMin(e)}</div>
    <input name="t" placeholder="무엇을 하나요? (Enter)" autocomplete="off" enterkeyhint="done">
    <div class="si-act"><button type="button" class="mini" data-act="slot-more">자세히</button><button type="button" class="mini ghost" data-act="slot-cancel">취소</button></div>`;
  col.appendChild(f);
  const inp = f.querySelector('input');
  inp.focus({ preventScroll: true });
  f.addEventListener('focusout', () => setTimeout(() => {
    if (!f.isConnected || f.contains(document.activeElement)) return;
    if (inp.value.trim()) createFromSlot(f, pointerDown);
    else f.remove();
  }, 120));
}

function closeSlotInputs() {
  $view.querySelectorAll('.slot-input').forEach((f) => {
    if (f.querySelector('input')?.value.trim()) createFromSlot(f, true);
    else f.remove();
  });
}

function createFromSlot(f, noRender) {
  if (!f.isConnected) return;
  const title = f.querySelector('input').value.trim();
  f.remove();
  if (!title) return;
  store.saveEvent({ title, date: f.dataset.date, start: fromMin(+f.dataset.s), end: fromMin(+f.dataset.e), color: S.lastColor, repeat: 'none' });
  if (noRender) pendingRender = true;
  else { render(); toast('일정을 적었어요'); }
}

function slotMore(f) {
  if (!f) return;
  const o = { date: f.dataset.date, start: fromMin(+f.dataset.s), end: fromMin(+f.dataset.e), title: f.querySelector('input').value.trim() };
  f.remove();
  openEventEditor(o);
}

// 손가락으로 톡 누르면 브라우저가 떼는 순간 뒤에 '클릭'을 한 번 더 보냄.
// 그 클릭이 방금 연 입력칸·창을 건드리지 않게, 클릭이 끝난 다음에 엶.
function afterTap(pointerType, fn) {
  if (pointerType === 'mouse') { fn(); return; }
  let done = false;
  let timer = null;
  const run = () => {
    if (done) return;
    done = true;
    removeEventListener('click', onClk, true);
    clearTimeout(timer);
    fn();
  };
  const onClk = () => setTimeout(run, 0);
  addEventListener('click', onClk, true);
  timer = setTimeout(run, 450);
}

function onGridPointerDown(e) {
  if (e.button > 0) return;
  const col = e.target.closest('.tg-col');
  if (!col || e.target.closest('.slot-input')) return;
  const evEl = e.target.closest('.ev');
  if (evEl) eventGesture(e, evEl, col);
  else slotGesture(e, col);
}

function slotGesture(e, col) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const date = col.dataset.date;
  const mouse = e.pointerType === 'mouse';
  const m0 = Math.floor(minuteAt(col, y0) / 30) * 30;
  let sel = null;
  let moved = false;
  const move = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) moved = true;
    if (!mouse || !moved) return;
    const mm = minuteAt(col, ev.clientY);
    const s = clamp(Math.min(m0, Math.floor(mm / 30) * 30), H0 * 60, H1 * 60 - 30);
    const en = clamp(Math.max(m0 + 30, Math.ceil(mm / 30) * 30), s + 30, H1 * 60);
    if (!sel) { sel = document.createElement('div'); sel.className = 'sel-rect'; col.appendChild(sel); }
    sel.style.top = pctOf(s);
    sel.style.height = pctLen(en - s);
    sel.dataset.s = s;
    sel.dataset.e = en;
    sel.textContent = `${fromMin(s)} – ${fromMin(en)}`;
  };
  const cleanup = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
  };
  const up = () => {
    cleanup();
    const target = () => (col.isConnected ? col : $view.querySelector(`.tg-col[data-date="${date}"]`));
    if (sel) {
      const s = +sel.dataset.s;
      const en = +sel.dataset.e;
      sel.remove();
      if (target()) openSlotInput(target(), s, en);
    } else if (!moved) {
      const s = clamp(m0, H0 * 60, H1 * 60 - 60);
      afterTap(e.pointerType, () => { const t = target(); if (t) openSlotInput(t, s, Math.min(s + 60, H1 * 60)); });
    }
  };
  const cancel = () => { cleanup(); sel?.remove(); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
}

function eventGesture(e, el, col) {
  const id = el.dataset.id;
  const occ = el.dataset.date;
  const ev = store.events.get(id);
  if (!ev) return;
  const resize = !!e.target.closest('.ev-resize');
  const mouse = e.pointerType === 'mouse';
  const x0 = e.clientX;
  const y0 = e.clientY;
  const s0 = toMin(ev.start);
  const e0 = Math.max(toMin(ev.end), s0 + 15);
  const dur = e0 - s0;
  const cols = [...el.closest('.tg').querySelectorAll('.tg-col')];
  const pxPerMin = col.getBoundingClientRect().height / TOTAL;
  let active = false;
  let moved = false;
  let timer = null;
  let ns = s0;
  let ne = e0;
  let nd = occ;

  const activate = () => {
    active = true;
    dragging = true;
    el.classList.add('dragging');
    el.style.left = '2px';
    el.style.width = 'calc(100% - 4px)';
    if (!mouse) navigator.vibrate?.(12);
  };
  if (!mouse) timer = setTimeout(activate, 350);

  const move = (m) => {
    const dx = m.clientX - x0;
    const dy = m.clientY - y0;
    if (!active) {
      if (mouse) { if (Math.hypot(dx, dy) > 4) activate(); else return; }
      else { if (Math.hypot(dx, dy) > 10) cleanup(); return; }
    }
    moved = true;
    const dmin = Math.round(dy / pxPerMin / 15) * 15;
    if (resize) {
      ne = clamp(e0 + dmin, s0 + 15, H1 * 60);
      el.style.height = pctLen(ne - Math.max(s0, H0 * 60));
    } else {
      ns = clamp(s0 + dmin, 0, 1440 - dur);
      ne = ns + dur;
      el.style.top = pctOf(Math.max(ns, H0 * 60));
      const c = cols.find((x) => { const r = x.getBoundingClientRect(); return m.clientX >= r.left && m.clientX < r.right; });
      if (c && c !== el.parentElement) { c.appendChild(el); nd = c.dataset.date; }
    }
    el.querySelector('.ev-t').textContent = `${fromMin(ns)}–${fromMin(ne)}`;
  };
  const tmove = (t) => { if (active && t.cancelable) t.preventDefault(); };
  const cleanup = () => {
    clearTimeout(timer);
    dragging = false;
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    removeEventListener('touchmove', tmove);
  };
  const up = () => {
    cleanup();
    if (active && moved) {
      const delta = dayDiff(occ, nd);
      const upd = { ...ev, start: fromMin(ns), end: fromMin(ne) };
      if (delta) upd.date = addDays(ev.date, delta);
      store.saveEvent(upd);
      render();
      toast(ev.repeat !== 'none' ? '반복 일정 전체가 옮겨졌어요' : `${fromMin(ns)}–${fromMin(ne)}로 옮겼어요`);
    } else {
      el.classList.remove('dragging');
      afterTap(e.pointerType, () => openEventEditor({ id, date: occ }));
    }
  };
  const cancel = () => { cleanup(); if (active) render(); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', cancel);
  addEventListener('touchmove', tmove, { passive: false });
}

/* 월 달력: 일정을 다른 날로 끌어 옮기기 (컴퓨터) */
function bindMonthDrag() {
  document.addEventListener('dragstart', (e) => {
    const chip = e.target.closest?.('.mo-ev');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: chip.dataset.id, from: chip.dataset.date }));
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragover', (e) => {
    const cell = e.target.closest?.('.mo-cell');
    if (!cell) return;
    e.preventDefault();
    $view.querySelectorAll('.mo-cell.drop').forEach((x) => x !== cell && x.classList.remove('drop'));
    cell.classList.add('drop');
  });
  document.addEventListener('drop', (e) => {
    const cell = e.target.closest?.('.mo-cell');
    if (!cell) return;
    e.preventDefault();
    let p;
    try { p = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    const ev = store.events.get(p.id);
    if (!ev) return;
    const delta = dayDiff(p.from, cell.dataset.date);
    if (delta) {
      store.saveEvent({ ...ev, date: addDays(ev.date, delta) });
      toast(ev.repeat !== 'none' ? '반복 일정 전체가 옮겨졌어요' : `${md(cell.dataset.date)}로 옮겼어요`);
    }
    render();
  });
  document.addEventListener('dragend', () => $view.querySelectorAll('.mo-cell.drop').forEach((x) => x.classList.remove('drop')));
}

/* 핸드폰: 오늘 화면을 옆으로 밀면 어제/내일 */
function bindSwipe() {
  let sw = null;
  $view.addEventListener('touchstart', (e) => {
    sw = null;
    if (S.view !== 'today' || !isPhone() || e.touches.length !== 1) return;
    if (e.target.closest('input, textarea, .ev, .slot-input')) return;
    const t = e.touches[0];
    sw = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  $view.addEventListener('touchend', (e) => {
    if (!sw || dragging) { sw = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - sw.x;
    const dy = t.clientY - sw.y;
    const dt = Date.now() - sw.t;
    sw = null;
    if (dt < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) changeDay(dx < 0 ? 1 : -1);
  }, { passive: true });
}

/* 자정 지나면 새 날로, 지금 시각 줄 움직이기 */
function tick() {
  const t = todayKey();
  if (t !== lastToday) {
    const was = S.date === lastToday;
    if (S.cal.sel === lastToday) S.cal.sel = t;
    lastToday = t;
    if (was) { S.date = t; resetDayUI(); }
    requestRender();
    if (was && S.view === 'today') toast('새로운 하루예요 · 오늘 페이지로 넘어왔어요');
    return;
  }
  const m = nowMin();
  $view.querySelectorAll('.now-line').forEach((l) => {
    l.style.top = pctOf(clamp(m, H0 * 60, H1 * 60));
    l.hidden = m < H0 * 60;
  });
}

function bindEvents() {
  document.addEventListener('click', onClick);
  $view.addEventListener('input', onInput);
  $view.addEventListener('keydown', onKeydown);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('submit', onSubmit);
  $view.addEventListener('pointerdown', onGridPointerDown);
  $view.addEventListener('contextmenu', (e) => { if (e.target.closest('.tg')) e.preventDefault(); });
  $view.addEventListener('dblclick', (e) => {
    const c = e.target.closest('.mo-cell, .wk-d');
    if (c && !e.target.closest('.mo-ev')) openDay(c.dataset.date);
  });
  document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
  const release = () => { pointerDown = false; };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && canRender()) render(); }, 60));
  setInterval(() => { if (pendingRender && canRender()) render(); }, 500);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal) { closeModal(); return; }
    if (modal || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.matches?.('input, textarea, select')) return;
    if (S.view === 'today') {
      if (e.key === 'ArrowLeft') changeDay(-1);
      else if (e.key === 'ArrowRight') changeDay(1);
      else if (e.key === 't' || e.key === 'T') { S.date = todayKey(); resetDayUI(); render(); }
    } else if (S.view === 'calendar') {
      if (e.key === 'ArrowLeft') calMove(-1);
      else if (e.key === 'ArrowRight') calMove(1);
    }
  });

  window.addEventListener('popstate', () => {
    if (skipPop) { skipPop = false; return; }
    if (modal) { closeModal(true); return; }
    const v = viewFromHash();
    if (v !== S.view) {
      S.view = v;
      if (v === 'calendar') S.cal.scrolled = false;
      render({ resetScroll: true });
    }
  });

  for (const id of ['fileCam', 'filePick']) {
    document.getElementById(id).addEventListener('change', async (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      await handleFiles(files);
    });
  }
  document.getElementById('fileImport').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importData(file);
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (S.view === 'today') requestRender();
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    toast('설치됐어요! 홈 화면에서 열어 보세요');
    requestRender();
  });

  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flushAll(); else tick(); });
  window.addEventListener('pagehide', () => store.flushAll());
  let lastPhone = isPhone();
  window.addEventListener('resize', () => { if (isPhone() !== lastPhone) { lastPhone = isPhone(); requestRender(); } });

  bindMonthDrag();
  bindSwipe();
}

/* 미리보기용 예시 데이터 (주소 끝에 ?demo 를 붙였을 때만, 따로 저장) */
async function seedDemo() {
  const t = todayKey();
  const ws = startOfWeek(t);
  const ago = (min) => Date.now() - min * 60000;
  store.editDay(t, (d) => {
    d.goal = '작은 것부터 끝까지';
    d.priorities[0] = { text: '데이터 시각화 과제 제출', done: true };
    d.priorities[1] = { text: '발표 자료 10장 만들기', done: false };
    d.priorities[2] = { text: '운동 30분', done: false };
    d.tasks = [{ id: uid(), text: '도서관 책 반납', done: false }, { id: uid(), text: '택배 찾기', done: true }];
    d.notes = [
      { id: uid(), text: '교수님 피드백: 그래프 축 이름 꼭 넣기', at: ago(90), photos: [] },
      { id: uid(), text: '팀 회의 자료 링크 https://example.com', at: ago(12), photos: [] },
    ];
  });
  store.editDay(addDays(t, -1), (d) => {
    d.priorities[0] = { text: '은행 서류 준비', done: false };
    d.priorities[1] = { text: '리포트 초안', done: true };
    d.priorities[2] = { text: '헬스 가기', done: false, missed: true };
    d.notes = [{ id: uid(), text: '어제 적은 메모 예시', at: ago(60 * 26), photos: [] }];
  });
  store.editDay(addDays(t, 1), (d) => { d.priorities[0] = { text: '면접 준비', done: false }; });
  const mk = (o) => store.saveEvent({ repeat: 'none', color: 'blue', ...o });
  mk({ title: '비즈니스 데이터 시각화', date: ws, start: '10:30', end: '12:00', repeat: 'weekly' });
  mk({ title: '경영전략', date: addDays(ws, 2), start: '13:00', end: '14:30', repeat: 'weekly', color: 'purple' });
  mk({ title: '헬스', date: ws, start: '07:00', end: '08:00', repeat: 'weekdays', color: 'green' });
  mk({ title: '팀 회의', date: t, start: '15:00', end: '16:00', color: 'pink' });
  mk({ title: '스터디', date: t, start: '15:30', end: '17:00', color: 'purple' });
  mk({ title: '알바', date: addDays(ws, 5), start: '18:00', end: '22:00', repeat: 'weekly', color: 'yellow' });
  mk({ title: '중간 발표', date: addDays(t, 2), allDay: true, color: 'pink' });
  await store.flushAll();
}

/* ---------------- 자동 업데이트 ----------------
   새 버전을 올리면(version.json 숫자 변경) 핸드폰·패드·노트북의 앱이
   - 앱을 새로 열 때: 바로 새 버전으로 열림 (sw.js가 항상 최신 파일을 먼저 받아 옴)
   - 켜 둔 채 다시 화면에 돌아올 때: 저장을 마치고 스스로 새로고침
   - 쓰는 도중이면: 위에 '업데이트' 버튼만 띄우고 기다림 */
async function latestVersion() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).version || null;
  } catch {
    return null;
  }
}

async function applyUpdate(v) {
  await Promise.race([store.flushAll(), new Promise((r) => setTimeout(r, 1500))]);
  try { sessionStorage.setItem('updatedTo', v); } catch { /* 무시 */ }
  location.reload();
}

async function checkUpdate(auto) {
  const v = await latestVersion();
  if (!v) return;
  if (!runningVersion) { runningVersion = v; return; }
  if (v === runningVersion) return;
  if (auto && canRender() && !modal) { applyUpdate(v); return; }
  const bar = document.getElementById('updateBar');
  bar.hidden = false;
  bar.querySelector('button').onclick = () => applyUpdate(v);
}

/* ---------------- 시작 ---------------- */
async function boot() {
  const demo = new URLSearchParams(location.search).has('demo');
  const local = new LocalBackend(demo ? 'daily-planner-demo' : 'daily-planner');
  await local.open();
  await store.start(local);
  if (demo && !store.days.size && !store.events.size) await seedDemo();
  if (demo) window.__planner = { store, S, render };
  store.on((type) => {
    if (type === 'data') requestRender();
    else if (type === 'status') renderStatus();
  });
  S.view = viewFromHash();
  bindEvents();
  render({ resetScroll: true });

  if (firebaseConfig && !demo) {
    store.setStatus({ hasConfig: true });
    try {
      const { createCloud } = await import('./cloud.js');
      await store.connectCloud(await createCloud(firebaseConfig));
    } catch (e) {
      console.error(e);
      store.setStatus({ error: '연동 서버에 연결하지 못했어요 (인터넷 확인)' });
    }
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn(e));
  }

  await checkUpdate(false);
  try {
    const up = sessionStorage.getItem('updatedTo');
    if (up) { sessionStorage.removeItem('updatedTo'); toast(`새 버전(v${up})으로 업데이트됐어요`); }
  } catch { /* 무시 */ }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(true); });
  setInterval(() => checkUpdate(false), 20 * 60 * 1000);
}

boot().catch((e) => {
  console.error(e);
  $view.innerHTML = `<div class="empty-big">앱을 여는 중 문제가 생겼어요.<br><small>${esc(e.message || e)}</small></div>`;
});
