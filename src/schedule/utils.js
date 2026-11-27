// 排课管理：常量、时间工具、冲突检测、布局与配色
export const HOUR_PX = 48;              // 每小时高度，半小时刻度 24px
export const SNAP_HOUR = 0.5;           // 30 分钟网格
export const TIME_W = 62;
export const LANE_W = 108;
export const WEEK_COL_W = 176;
export const DAY_COL_W = 620;

export const DEFAULT_SETTINGS = {
  startHour: 7,
  endHour: 21,
  snap: true,
  showStudents: true,
  // 布局类
  splitByTeacher: true,   // 周/日视图：同一天多个教师时按教师拆分独立时间线
  showRuler: true,        // 右侧第二条时间刻度
  dense: false,           // 紧凑课块：隐藏学生名单与底部时间行
  // 显示类
  showConflicts: true,    // 冲突课块高亮
  showBadges: true,       // 循环系列 / 课程状态标记
  showConflictBar: true,  // 顶部冲突汇总条
};

export const WEEK_OPTIONS = [
  { label: '一', value: 1 }, { label: '二', value: 2 }, { label: '三', value: 3 },
  { label: '四', value: 4 }, { label: '五', value: 5 }, { label: '六', value: 6 },
  { label: '日', value: 0 },
];
export const ALL_WEEK = WEEK_OPTIONS.map((d) => d.value);
export const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

export const LESSON_STATUS = [
  { value: 'normal', label: '正常', color: '#6f8f7d' },
  { value: 'leave', label: '请假', color: '#c99a5b' },
  { value: 'suspended', label: '停课', color: '#b06a66' },
];

// 课程重复规则：创建后按当前学期范围向后顺延（往前的日期不碰）
export const REPEAT_OPTIONS = [
  { value: 'none', label: '不重复' },
  { value: 'weekly', label: '每周重复' },
  { value: 'monthly', label: '每月重复' },
];
export const repeatLabel = (v) => REPEAT_OPTIONS.find((o) => o.value === v)?.label || '不重复';

// 柔和低饱和莫兰迪色系，按教师稳定分配
export const PALETTE = [
  { bg: '#e9e3d7', border: '#cbbfa5', text: '#5b5240' },
  { bg: '#dfe8e3', border: '#aec6bb', text: '#3f5c51' },
  { bg: '#e7e0e9', border: '#c4b4cc', text: '#5b4d64' },
  { bg: '#ece1dc', border: '#d0b5ab', text: '#6b5047' },
  { bg: '#dfe6ee', border: '#b1c2d3', text: '#465970' },
  { bg: '#e8e7d9', border: '#c6c3a1', text: '#59583b' },
  { bg: '#e6e2dc', border: '#c5bbab', text: '#594f43' },
  { bg: '#dfe9e9', border: '#aec7c7', text: '#3f5c5c' },
];
export const colorOf = (teacherId) => PALETTE[Math.abs(Number(teacherId) || 0) % PALETTE.length];

// ---------- 日期 ----------
export function fmt(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseLocal(s) { return new Date(`${s}T00:00:00`); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function weekOf(dateStr) { return `周${WEEK_CN[parseLocal(dateStr).getDay()]}`; }

// ---------- 时间 ----------
export function parseTime(t) {
  if (typeof t === 'number') return t;
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) + (m || 0) / 60;
}
export function toTimeStr(v) {
  const h = Math.floor(v), m = Math.round((v - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
export function hhmm(v) { return toTimeStr(v).slice(0, 5); }
export function timesOf(l) { return [parseTime(l.start_time), parseTime(l.end_time)]; }
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function snapHour(v, settings) {
  const raw = settings?.snap === false ? Math.round(v * 4) / 4 : Math.round(v / SNAP_HOUR) * SNAP_HOUR;
  return clamp(raw, settings?.startHour ?? 7, settings?.endHour ?? 21);
}
export function disabledHoursBefore(h) { return Array.from({ length: h }, (_, i) => i); }
export function disabledHoursAfter(h) { return Array.from({ length: 24 - h }, (_, i) => h + i); }

// ---------- 冲突 ----------
export function timeOverlap(a, b) {
  const [as, ae] = timesOf(a), [bs, be] = timesOf(b);
  return as < be && bs < ae;
}
const overlap = timeOverlap;
export function conflictKind(a, b) {
  if (a.slot_date !== b.slot_date || !overlap(a, b)) return null;
  const sameTeacher = a.teacher_id != null && String(a.teacher_id) === String(b.teacher_id);
  const sameRoom = a.classroom_id != null && String(a.classroom_id) === String(b.classroom_id);
  if (sameTeacher && sameRoom) return 'both';
  if (sameTeacher) return 'teacher';
  if (sameRoom) return 'room';
  return null;
}
export function conflictLabel(k) {
  return k === 'teacher' ? '教师时间冲突' : k === 'room' ? '教室时间冲突' : '教师与教室均冲突';
}

// 返回 Map<lessonId, [{kind, with}]>；学生冲突单独作为弱提示
export function buildConflictMap(lessons) {
  const map = new Map();
  const byDate = new Map();
  lessons.forEach((l) => {
    if (!byDate.has(l.slot_date)) byDate.set(l.slot_date, []);
    byDate.get(l.slot_date).push(l);
  });
  const add = (id, info) => {
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(info);
  };
  byDate.forEach((list) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const kind = conflictKind(list[i], list[j]);
        if (!kind) continue;
        add(list[i].id, { kind, with: list[j] });
        add(list[j].id, { kind, with: list[i] });
      }
    }
  });
  return map;
}

// ---------- 冲突域 ----------
// 判定键只有一个：**日期 + 时间重叠 + (同一教师 或 同一教室)**。
// 课程名 / 课程 id 完全不参与——同一教师在同一时段不管上哪门课，都只能有一节课。
// 同一天里互相连通的冲突合并成「一个冲突域」，界面按域提示，避免同一处冲突被重复数成多节课。
export function conflictDomains(lessons) {
  const list = Array.isArray(lessons) ? lessons : [];
  if (list.length < 2) return [];

  const parent = new Map();
  const find = (x) => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  list.forEach((l) => parent.set(l.id, l.id));

  const byDate = new Map();
  list.forEach((l) => {
    if (!byDate.has(l.slot_date)) byDate.set(l.slot_date, []);
    byDate.get(l.slot_date).push(l);
  });
  byDate.forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (conflictKind(group[i], group[j])) union(group[i].id, group[j].id);
      }
    }
  });

  const comps = new Map();
  list.forEach((l) => {
    const root = find(l.id);
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root).push(l);
  });

  const out = [];
  comps.forEach((items) => {
    if (items.length < 2) return;
    const teacherIds = [...new Set(items.map((i) => i.teacher_id).filter((v) => v != null).map(String))];
    const roomIds = [...new Set(items.map((i) => i.classroom_id).filter((v) => v != null).map(String))];
    const starts = items.map((i) => parseTime(i.start_time));
    const ends = items.map((i) => parseTime(i.end_time));
    const byTeacher = teacherIds.length === 1;
    out.push({
      key: items.map((i) => i.id).sort((a, b) => a - b).join('-'),
      date: items[0].slot_date,
      start: Math.min(...starts),
      end: Math.max(...ends),
      teacherId: byTeacher ? teacherIds[0] : null,
      teacherName: [...new Set(items.map((i) => i.teacher_name).filter(Boolean))].join('、'),
      roomName: [...new Set(items.map((i) => i.classroom_name).filter(Boolean))].join('、'),
      reason: byTeacher ? '同一位教师同一时段安排了多节课' : '教室在同一时段被多节课占用',
      count: items.length,
      lessons: [...items].sort((a, b) => parseTime(a.start_time) - parseTime(b.start_time) || a.id - b.id),
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

// 学生同一时段多课：仅提示，不做强约束
export function buildStudentHints(lessons) {
  const map = new Map();
  const byDate = new Map();
  lessons.forEach((l) => {
    if (!byDate.has(l.slot_date)) byDate.set(l.slot_date, []);
    byDate.get(l.slot_date).push(l);
  });
  byDate.forEach((list) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!overlap(list[i], list[j])) continue;
        const names = (list[j].students || []).map((s) => s.name);
        const shared = (list[i].students || []).filter((s) => names.includes(s.name)).map((s) => s.name);
        shared.forEach((n) => {
          const key = list[i].id;
          if (!map.has(key)) map.set(key, new Set());
          map.get(key).add(`${n} 同时段另有课程`);
          if (!map.has(list[j].id)) map.set(list[j].id, new Set());
          map.get(list[j].id).add(`${n} 同时段另有课程`);
        });
      }
    }
  });
  return map;
}

// 拖拽落位前的单条冲突检测
export function hasConflict(candidate, lessons, excludeId) {
  return lessons.some((l) => l.id !== excludeId && conflictKind(candidate, l));
}

// 按「排课教师」归属把冲突分为两类：
//  - self：与本人（同一 teacher_id）时段重叠 → 可直接覆盖（删除旧课、生成/移动新课）
//  - other：与其他教师冲突（教室被占/与其他教师时间重叠）→ 仅提示，不可覆盖
// teacherId 为本次排课的归属教师；excludeId 用于编辑/移动时排除自身
export function conflictGroups(candidate, lessons, excludeId, teacherId) {
  // 防御：调用方可能传入尚未加载的 undefined，退化为空数组而非抛错
  const list = Array.isArray(lessons) ? lessons : [];
  const hits = list.filter((l) => l.id !== excludeId && conflictKind(candidate, l));
  const tid = teacherId == null ? null : String(teacherId);
  const self = hits.filter((l) => (l.teacher_id == null ? null : String(l.teacher_id)) === tid);
  const other = hits.filter((l) => (l.teacher_id == null ? null : String(l.teacher_id)) !== tid);
  return { self, other, any: hits.length > 0 };
}

// ---------- 布局 ----------
// 同一泳道内重叠的课块左右并排：按区间分配列，列数 = 最大同时重叠数。
// 不重叠的课块独占整列宽度，避免文字被无谓挤压。
export function layoutLane(blocks) {
  const sorted = [...blocks].sort((a, b) => timesOf(a)[0] - timesOf(b)[0] || a.id - b.id);
  const colEnds = [];
  const assigned = new Map();
  sorted.forEach((b) => {
    const [s, e] = timesOf(b);
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) { col = colEnds.length; colEnds.push(e); }
    else colEnds[col] = e;
    assigned.set(b.id, col);
  });
  const n = Math.max(1, colEnds.length);
  const out = new Map();
  assigned.forEach((col, id) => out.set(id, { left: (col / n) * 100, width: 100 / n, n }));
  return out;
}

export function laneOf(lesson, viewMode) {
  if (viewMode === 'teacher') return { key: `T${lesson.teacher_id ?? 0}`, value: lesson.teacher_id, label: lesson.teacher_name || '未指定教师' };
  if (viewMode === 'room') return { key: `R${lesson.classroom_id ?? 0}`, value: lesson.classroom_id, label: lesson.classroom_name || '未指定教室' };
  return { key: 'ALL', value: null, label: '' };
}

// 周 / 日视图：同一天有多位教师时，按教师拆成互不共用的纵向时间线。
// 这样每位教师的课只落在自己的竖条里，任何时候都不会和别人的课左右挤在一起。
// 教师 / 教室视图返回 null，表示沿用全天统一的资源泳道（groupLanes）。
export function lanesOfDay(dayLessons, viewMode, teachers = []) {
  if (viewMode === 'teacher' || viewMode === 'room') return null;
  const ids = [...new Set(dayLessons.map((l) => l.teacher_id ?? 0))];
  if (!ids.length) return [{ key: 'ALL', value: null, label: '', kind: 'all' }];
  const order = new Map(teachers.map((t, i) => [t.id, i]));
  return ids
    .map((id) => ({
      key: `T${id}`, value: id || null, kind: 'teacher',
      label: teachers.find((t) => t.id === id)?.name || '未指定教师',
    }))
    .sort((a, b) => ((order.get(a.value) ?? 999) - (order.get(b.value) ?? 999))
      || String(a.label).localeCompare(String(b.label), 'zh-CN'));
}

// 某节课程应落到的泳道 key（周/日视图按教师，教师/教室视图按资源）
export function laneKeyOf(lesson, viewMode) {
  if (viewMode === 'room') return `R${lesson.classroom_id ?? 0}`;
  return `T${lesson.teacher_id ?? 0}`;
}

export function groupLanes(lessons, viewMode, teachers, classrooms) {
  if (viewMode === 'week' || viewMode === 'day') {
    return [{ key: 'ALL', value: null, label: '', kind: 'all' }];
  }
  const map = new Map();
  const list = viewMode === 'teacher' ? teachers : classrooms;
  list.forEach((r) => map.set(viewMode === 'teacher' ? `T${r.id}` : `R${r.id}`, {
    key: viewMode === 'teacher' ? `T${r.id}` : `R${r.id}`, value: r.id, label: r.name,
    kind: viewMode === 'teacher' ? 'teacher' : 'room',
  }));
  lessons.forEach((l) => {
    const { key, value, label } = laneOf(l, viewMode);
    if (!map.has(key)) {
      map.set(key, { key, value, label: label || '未指定', kind: viewMode === 'teacher' ? 'teacher' : 'room' });
    }
  });
  return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}
