// 날짜·시간·문자열 도우미 (모든 날짜는 이 기기 시간 기준 'YYYY-MM-DD')

export const pad = (n) => String(n).padStart(2, '0');
export const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = (k) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayKey = () => keyOf(new Date());
export const addDays = (k, n) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};
export const addMonths = (k, n) => {
  const d = parseKey(k);
  return keyOf(new Date(d.getFullYear(), d.getMonth() + n, 1));
};
export const dayDiff = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);

// 월요일 = 0 … 일요일 = 6 (교수님 양식처럼 M T W T F S S 순서)
export const wdIdx = (k) => (parseKey(k).getDay() + 6) % 7;
export const WD = ['월', '화', '수', '목', '금', '토', '일'];
export const WD_FULL = WD.map((w) => `${w}요일`);
// 한 주는 일요일부터 (갤럭시 달력처럼)
export const startOfWeek = (k) => addDays(k, -((wdIdx(k) + 1) % 7));

export const toMin = (t) => {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const hhmm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 메모 글: 링크는 눌러서 열 수 있게, 줄바꿈은 그대로
export function richText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

export const md = (k) => {
  const d = parseKey(k);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export function relLabel(k) {
  const n = dayDiff(todayKey(), k);
  if (n === 0) return '오늘';
  if (n === 1) return '내일';
  if (n === -1) return '어제';
  return n > 0 ? `${n}일 후` : `${-n}일 전`;
}
