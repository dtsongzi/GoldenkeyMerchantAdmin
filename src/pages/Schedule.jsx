import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Select, Checkbox, Space, Tag, Typography, Modal, TimePicker, DatePicker as AntDatePicker, Input, App as AntApp } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, currentUser } from '../api.js';

// 用数值方式构造时间，不依赖 dayjs('10:30','HH:mm')（该写法需 customParseFormat 插件，否则 Invalid Date）
function toDayjs(v) {
  const vv = Math.min(v, 23 + 59 / 60); // 24:00 收敛到 23:59，避免 TimePicker 滚到次日
  const h = Math.floor(vv), m = Math.round((vv - h) * 60);
  return dayjs().hour(Math.min(23, h)).minute(m).second(0).millisecond(0);
}

// ---------- 常量 ----------
const HOUR_PX = 44;
const HOUR_START = 6;
const HOUR_END = 24;
const HOURS = HOUR_END - HOUR_START;
const GRID_H = HOURS * HOUR_PX;
const COL_W = 132;
const LANE_W = 96;
const HOURS_W = 52;
const WINDOW = 10;
const SNAP = 0.25;

// ---------- 工具 ----------
function fmt(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseTime(t) { if (t == null) return 0; const [h, m] = String(t).split(':').map(Number); return (h || 0) + (m || 0) / 60; }
function toTimeStr(v) {
  const h = Math.floor(v), m = Math.round((v - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
function hhmm(v) { return toTimeStr(v).slice(0, 5); }
function clampHour(v) { return Math.min(HOUR_END, Math.max(HOUR_START, Math.round(v / SNAP) * SNAP)); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parseLocal(s) { return new Date(s + 'T00:00:00'); }

// 关键：availability.id 与 bookings.id 是两套独立自增序列，直接用 id 做 key 会撞车，
// 导致「拖动一个块，另一个表同 id 的块跟着一起动」。统一用 kind:id 作为唯一键。
function uidOf(b) { return `${b.kind || 'avail'}:${b.id}`; }
function blockHours(b) {
  if (typeof b.start === 'number' && typeof b.end === 'number') return [b.start, b.end];
  return [parseTime(b.start_time), parseTime(b.end_time)];
}
// 草稿基准：以当前块的真实时间为准
function baseDraft(b) {
  const [start, end] = blockHours(b);
  return {
    uid: uidOf(b), id: b.id, kind: b.kind, teacherId: b.teacher_id ?? null,
    classroomId: b.classroom_id ?? null,
    start, end, deleted: false, changed: false,
  };
}
// 草稿新增块带上绘制时的车道 key，松手后仍留在原车道，避免选区「跳走」
function laneKey(b) { return b.lane_key || (b.teacher_id ? 'T' + b.teacher_id : 'NA'); }

// 无排课的日期也保留一条空车道，供用户点击/拖选新增
function groupLanes(dayBlocks, defaultTeacherId = null) {
  const map = new Map();
  dayBlocks.forEach((b) => {
    const k = laneKey(b);
    if (!map.has(k)) map.set(k, { key: k, teacherId: b.teacher_id, blocks: [] });
    map.get(k).blocks.push(b);
  });
  if (!map.size) {
    const k = defaultTeacherId ? 'T' + defaultTeacherId : 'NA';
    map.set(k, { key: k, teacherId: defaultTeacherId, blocks: [] });
  }
  return [...map.values()];
}
function dayWidth(lanes) {
  const K = lanes.length || 1;
  return K === 1 ? COL_W : K * LANE_W;
}
function computeWidths(days, blocks, defaultTeacherId) {
  return days.map((d) => dayWidth(groupLanes(blocks.filter((b) => b.slot_date === fmt(d)), defaultTeacherId)));
}

// ---------- 课程表网格（主表 / 预览复用） ----------
function ScheduleGrid({
  days, blocks, canModify, drafts = {}, selection, defaultTeacherId, classrooms = [],
  onBlockClick, onResizeStart, onDelete, onRestore, onLanePointerDown,
  scrollRef, selected, onSelectDay, onScroll,
}) {
  const widths = computeWidths(days, blocks, defaultTeacherId);
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  const roomName = (id) => (classrooms.find((r) => String(r.id) === String(id)) || {}).name || '';

  const renderBlock = (b) => {
    const uid = uidOf(b);
    const dft = drafts[uid];
    const [st, en] = dft ? [dft.start, dft.end] : blockHours(b);
    const top = Math.max(0, (st - HOUR_START) * HOUR_PX);
    const h = Math.max(6, (en - st) * HOUR_PX);
    const isBook = b.kind === 'book';
    const isNew = b.kind === 'new';
    const deleted = !!dft?.deleted;
    const changed = !!dft?.changed && !deleted;
    const mod = !deleted && (canModify ? canModify(b) : false);
    const roomLabel = dft && dft.classroomId !== undefined && dft.classroomId !== (b.classroom_id ?? null)
      ? roomName(dft.classroomId)
      : (b.classroom_name || roomName(dft?.classroomId) || '');
    const cls = [
      'block',
      isBook ? 'book' : isNew ? 'new' : 'avail',
      mod ? 'editable' : '', deleted ? 'deleted' : '', changed ? 'changed' : '',
    ].filter(Boolean).join(' ');
    return (
      <div key={uid} className={cls} style={{ top, height: h }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => mod && !isBook && onBlockClick && onBlockClick(b)}
        title={`${hhmm(st)}-${hhmm(en)} ${b.teacher_name || ''} ${roomLabel} ${b.course_title || ''} ${b.member_name || ''}${deleted ? '（已标记删除，点「保存全部」生效）' : ''}`}>
        {deleted ? (
          <span className="block-undo" role="button" title="撤销删除"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRestore && onRestore(b); }}>↶</span>
        ) : mod && (
          <span className="block-del" role="button" title="标记删除（保存后生效）"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete && onDelete(b); }}>×</span>
        )}
        <div className="block-teacher">
          {isNew ? '＋ 待保存' : (b.teacher_name || '未排')}
          {deleted && ' · 将删除'}
          {changed && ' · 已改'}
        </div>
        {roomLabel && <div className="block-room">{roomLabel}</div>}
        {(isNew || changed) && <div className="block-course">{hhmm(st)}-{hhmm(en)}</div>}
        {b.course_title && <div className="block-course">{b.course_title}</div>}
        {b.member_name && <div className="block-member">{b.member_name}</div>}
        {mod && !isBook && !isNew && onResizeStart && (
          <>
            <div className="block-handle top" onPointerDown={(e) => onResizeStart(e, 'top', b)} onClick={(e) => e.stopPropagation()} />
            <div className="block-handle bottom" onPointerDown={(e) => onResizeStart(e, 'bottom', b)} onClick={(e) => e.stopPropagation()} />
          </>
        )}
      </div>
    );
  };

  return (
    <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
      <div className="grid-inner" style={{ width: HOURS_W + totalWidth }}>
        <div className="grid-head">
          <div className="head-hours">时间</div>
          {days.map((d, i) => (
            <div key={i}
              className={'head-day' + (selected === fmt(d) ? ' active' : '')}
              style={{ width: widths[i] }}
              onClick={() => onSelectDay && onSelectDay(i)}>
              <span className="mc">{d.getMonth() + 1}/{d.getDate()}</span>
              <span className="wk">{['日', '一', '二', '三', '四', '五', '六'][d.getDay()]}</span>
            </div>
          ))}
        </div>
        <div className="grid-body">
          <div className="grid-hours" style={{ height: GRID_H }}>
            {Array.from({ length: HOURS }, (_, i) => <div key={i} className="hour-label">{HOUR_START + i}:00</div>)}
          </div>
          {days.map((d, i) => {
            const key = fmt(d);
            const lanes = groupLanes(blocks.filter((b) => b.slot_date === key), defaultTeacherId);
            const lw = lanes.length === 1 ? COL_W : LANE_W;
            return (
              <div key={i} className={'grid-col' + (key === selected ? ' sel' : '')} style={{ width: widths[i], height: GRID_H }}>
                <div className="col-lanes">
                  {lanes.map((lane) => {
                    const showSel = selection && selection.date === key && selection.laneKey === lane.key;
                    return (
                      <div key={lane.key} className="lane" style={{ width: lw }}
                        onPointerDown={(e) => onLanePointerDown && onLanePointerDown(e, key, lane.key, lane.teacherId)}>
                        {lane.blocks.map(renderBlock)}
                        {showSel && (
                          <div className="sel-block"
                            style={{ top: (selection.start - HOUR_START) * HOUR_PX, height: Math.max(6, (selection.end - selection.start) * HOUR_PX) }}>
                            <span>{hhmm(selection.start)}</span>
                            <span>{hhmm(selection.end)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- 页面 ----------
export default function Schedule({ user }) {
  const { message } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const isTeacher = role === 'teacher';
  const canEdit = isAdmin || isTeacher;
  const myTeacherId = user?.teacherId || currentUser()?.teacherId;

  const today = new Date();
  const [windowStart, setWindowStart] = useState(fmt(addDays(today, -4)));
  const [selected, setSelected] = useState(fmt(today));
  const [teacherId, setTeacherId] = useState(isAdmin ? '' : String(myTeacherId));
  const [teachers, setTeachers] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editor, setEditor] = useState(null);
  const [saving, setSaving] = useState(false);

  // 统一草稿：drafts = 已有块的修改/删除标记；creates = 空白区新增的块。
  // 所有操作都只改这两处，点「保存全部」才调用后端。
  const [drafts, setDrafts] = useState({});
  const [creates, setCreates] = useState([]);
  const [activeCid, setActiveCid] = useState(null);   // 正在编辑的新增草稿
  const [selection, setSelection] = useState(null);   // 拖动过程中的实时选区
  const [quick, setQuick] = useState({ startDate: fmt(today), endDate: fmt(addDays(today, 14)), startHour: '10:00', endHour: '21:00', weekdaysOnly: false, msg: '' });
  const [preview, setPreview] = useState(null);
  const [roomMgr, setRoomMgr] = useState(false);       // 教室管理弹窗
  const [newRoomName, setNewRoomName] = useState('');

  const scrollRef = useRef(null);
  const dragRef = useRef(null);
  const draftsRef = useRef({});          // 拖动时用 ref 读最新草稿，避免闭包过期
  const selectRef = useRef(null);
  const selValueRef = useRef(null);
  const createSeq = useRef(0);

  const effTeacher = isAdmin ? (teacherId || '') : String(myTeacherId);
  const defaultTeacherId = effTeacher ? Number(effTeacher) : (teachers[0]?.id ?? null);
  const defaultRoomId = classrooms[0]?.id ?? null;

  // 草稿写入统一走这里：ref 与 state 同步，避免多次拖动之间读到旧值
  const setAllDrafts = (next) => { draftsRef.current = next; setDrafts(next); };
  const patchDraft = (b, fn) => {
    const uid = uidOf(b);
    const next = { ...draftsRef.current };
    const cur = next[uid] || baseDraft(b);
    next[uid] = fn(cur);
    setAllDrafts(next);
  };
  const resetDrafts = () => {
    setAllDrafts({});
    setCreates([]);
    setActiveCid(null);
    setSelection(null);
    selectRef.current = null;
    selValueRef.current = null;
    dragRef.current = null;
  };

  const load = () => {
    setLoading(true);
    const from = windowStart;
    const to = fmt(addDays(parseLocal(windowStart), WINDOW - 1));
    api.scheduleGrid({ from, to, teacherId: effTeacher })
      .then(setBlocks).catch(() => setBlocks([])).finally(() => setLoading(false));
  };
  useEffect(() => { api.teachers().then(setTeachers).catch(() => {}); }, []);
  useEffect(() => { api.classrooms().then(setClassrooms).catch(() => {}); }, []);
  useEffect(() => { resetDrafts(); load(); /* eslint-disable-next-line */ }, [windowStart, effTeacher]);

  // 网格实际渲染的块 = 数据库块（含删除标记）+ 新增草稿块
  const displayBlocks = useMemo(
    () => [...blocks, ...creates],
    [blocks, creates]
  );
  const days = useMemo(
    () => Array.from({ length: WINDOW }, (_, i) => addDays(parseLocal(windowStart), i)),
    [windowStart]
  );
  const widths = useMemo(
    () => computeWidths(days, displayBlocks, defaultTeacherId),
    /* eslint-disable-next-line */ [days, displayBlocks, defaultTeacherId]
  );

  const scrollToDay = (idx) => {
    if (scrollRef.current) scrollRef.current.scrollTo({ left: widths.slice(0, idx).reduce((a, b) => a + b, 0), behavior: 'smooth' });
    setSelected(fmt(days[idx]));
  };
  const onScroll = () => {
    if (!scrollRef.current) return;
    const sl = scrollRef.current.scrollLeft;
    let acc = 0;
    for (let i = 0; i < days.length; i++) { if (sl < acc + widths[i]) { setSelected(fmt(days[i])); return; } acc += widths[i]; }
  };
  const shift = (n) => setWindowStart(fmt(addDays(parseLocal(windowStart), n)));

  const canModify = (b) => {
    if (!canEdit) return false;
    if (b.kind === 'new') return true;
    if (isAdmin) return true;
    return b.kind === 'avail' && String(b.teacher_id) === String(myTeacherId);
  };

  // ---------- 编辑弹窗：只记草稿 ----------
  const openEditor = (b) => {
    if (b.kind === 'new') { setActiveCid(b.cid); return; }   // 新增块用上方草稿条编辑
    const d = draftsRef.current[uidOf(b)] || baseDraft(b);
    setEditor({ uid: uidOf(b), b, start: d.start, end: d.end, teacherId: d.teacherId ?? '', classroomId: d.classroomId ?? '', dirty: false });
  };
  const stageEditor = () => {
    if (!editor) return;
    if (editor.end <= editor.start) { message.warning('结束时间需晚于开始时间'); return; }
    patchDraft(editor.b, (d) => ({
      ...d, start: editor.start, end: editor.end,
      teacherId: editor.teacherId || null, classroomId: editor.classroomId || null,
      changed: true, deleted: false,
    }));
    setEditor(null);
    message.info('已记入草稿，点击「保存全部」后生效');
  };

  // ---------- 拖动边界改时段（每个块独立草稿） ----------
  const startResize = (e, edge, b) => {
    e.stopPropagation();
    e.preventDefault();
    const uid = uidOf(b);
    const base = draftsRef.current[uid] || baseDraft(b);
    // 已有草稿则以草稿为基准，保证先拖上边界再拖下边界时上一半的调整被保留
    dragRef.current = { uid, edge, startY: e.clientY, baseStart: base.start, baseEnd: base.end, base };
    if (!draftsRef.current[uid]) patchDraft(b, () => base);
    document.body.style.userSelect = 'none';
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 忽略 */ }

    let raf = 0, lastY = e.clientY;
    const move = (ev) => {
      lastY = ev.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = dragRef.current;
        if (!s) return;
        const snap = Math.round(((lastY - s.startY) / HOUR_PX) / SNAP) * SNAP;
        let start = s.baseStart, end = s.baseEnd;
        if (s.edge === 'top') start = Math.max(HOUR_START, Math.min(s.baseEnd - SNAP, s.baseStart + snap));
        else end = Math.min(HOUR_END, Math.max(s.baseStart + SNAP, s.baseEnd + snap));
        const next = { ...draftsRef.current };
        const cur = next[s.uid] || s.base;
        next[s.uid] = { ...cur, start, end, changed: cur.changed || start !== s.baseStart || end !== s.baseEnd };
        setAllDrafts(next);
      });
    };
    const up = () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = '';
      dragRef.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---------- 删除：只打删除标记，不调用接口 ----------
  const markDelete = (b) => {
    if (b.kind === 'new') {
      setCreates((prev) => prev.filter((c) => c.cid !== b.cid));
      if (activeCid === b.cid) setActiveCid(null);
      return;
    }
    patchDraft(b, (d) => ({ ...d, deleted: true }));
  };
  const restore = (b) => {
    const uid = uidOf(b);
    const next = { ...draftsRef.current };
    const d = next[uid];
    if (!d) return;
    if (!d.changed) delete next[uid];
    else next[uid] = { ...d, deleted: false };
    setAllDrafts(next);
  };

  // ---------- 空白处点击 / 拖动框选新增时段 ----------
  // 松手后立刻把选区变成「新增草稿块」渲染在网格里，所以选区不会消失
  const startSelect = (e, date, laneKeyOfLane, laneTeacherId) => {
    if (!canEdit || e.button !== 0 || dragRef.current || selectRef.current) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const anchor = clampHour(HOUR_START + (e.clientY - rect.top) / HOUR_PX);
    const start = Math.min(anchor, HOUR_END - SNAP);
    const tid = isTeacher ? myTeacherId : (laneTeacherId ?? defaultTeacherId ?? null);
    const session = { date, laneKey: laneKeyOfLane, teacherId: tid, anchor, rectTop: rect.top };
    selectRef.current = session;
    const initial = { date, laneKey: laneKeyOfLane, teacherId: tid, start, end: Math.min(HOUR_END, start + 1) };
    selValueRef.current = initial;
    setSelection(initial);
    document.body.style.userSelect = 'none';

    const move = (ev) => {
      const s = selectRef.current;
      if (!s) return;
      const t = clampHour(HOUR_START + (ev.clientY - s.rectTop) / HOUR_PX);
      const st = Math.min(s.anchor, t);
      const en = Math.max(s.anchor, t, st + SNAP);
      const v = { date: s.date, laneKey: s.laneKey, teacherId: s.teacherId, start: st, end: Math.min(HOUR_END, en) };
      selValueRef.current = v;
      setSelection(v);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.style.userSelect = '';
      selectRef.current = null;
      const v = selValueRef.current;
      selValueRef.current = null;
      setSelection(null);
      if (!v || v.end <= v.start) return;
      const cid = 'c' + (++createSeq.current);
      setCreates((prev) => [...prev, {
        cid, id: cid, kind: 'new', slot_date: v.date, start: v.start, end: v.end,
        lane_key: v.laneKey,
        teacher_id: isTeacher ? myTeacherId : (v.teacherId ?? null), teacher_name: '',
        classroom_id: defaultRoomId, classroom_name: classrooms.find((r) => r.id === defaultRoomId)?.name || '',
        course_title: null, member_name: null,
      }]);
      setActiveCid(cid);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const activeCreate = creates.find((c) => c.cid === activeCid) || null;
  const updateCreate = (cid, patch) => setCreates((prev) => prev.map((c) => (c.cid === cid ? { ...c, ...patch } : c)));
  const teacherName = (id) => teachers.find((t) => String(t.id) === String(id))?.name || '';

  // ---------- 保存全部：唯一写库入口 ----------
  const draftList = Object.values(drafts);
  const changeCount = draftList.filter((d) => d.changed && !d.deleted).length;
  const deleteCount = draftList.filter((d) => d.deleted).length;
  const createCount = creates.length;
  const pendingCount = changeCount + deleteCount + createCount;

  // 本地预估：保存后会覆盖掉多少个「已有可约块」（后端还会额外排除已被学员预约的）
  const overwritePreview = (() => {
    const items = [];
    draftList.forEach((d) => {
      if (d.deleted || !d.changed) return;
      const b = blocks.find((x) => uidOf(x) === d.uid);
      if (b && b.kind === 'avail') {
        items.push({ uid: d.uid, date: b.slot_date, start: d.start, end: d.end, teacherId: d.teacherId, classroomId: d.classroomId });
      }
    });
    creates.forEach((c) => items.push({
      uid: c.cid, date: c.slot_date, start: c.start, end: c.end, teacherId: c.teacher_id, classroomId: c.classroom_id,
    }));
    const hit = new Set();
    items.forEach((it) => {
      blocks.forEach((b) => {
        if (b.kind !== 'avail' || b.slot_date !== it.date) return;
        const u = uidOf(b);
        if (u === it.uid || drafts[u]?.deleted) return;
        const [bs, be] = blockHours(b);
        const sameTeacher = String(b.teacher_id) === String(it.teacherId);
        const sameRoom = !!it.classroomId && String(b.classroom_id) === String(it.classroomId);
        if (!sameTeacher && !sameRoom) return;
        if (bs < it.end && be > it.start) hit.add(u);
      });
    });
    return hit.size;
  })();

  const saveAll = async () => {
    if (!pendingCount) return;
    const bad = creates.find((c) => c.end <= c.start || !c.teacher_id);
    if (bad) { message.warning('存在结束时间不合法或未指定教师的新增时段，请先修正'); setActiveCid(bad.cid); return; }
    setSaving(true);
    try {
      let overwritten = 0, blocked = 0;
      for (const d of draftList.filter((x) => x.deleted)) {
        await api.deleteScheduleBlock(d.id, d.kind);
      }
      // overwrite: true —— 拖动后的时段若盖住其他块，由后端删除被覆盖的块（已有学员预约的跳过）
      for (const d of draftList.filter((x) => x.changed && !x.deleted)) {
        const r = await api.updateScheduleBlock(d.id, {
          start_time: toTimeStr(d.start), end_time: toTimeStr(d.end),
          teacher_id: d.teacherId || null, classroom_id: d.classroomId || null, overwrite: true,
        });
        overwritten += Number(r?.deleted || 0);
        blocked += Number(r?.skipped || 0);
      }
      for (const c of creates) {
        const r = await api.createScheduleBlock({
          slot_date: c.slot_date, start_time: toTimeStr(c.start), end_time: toTimeStr(c.end),
          teacher_id: c.teacher_id, classroom_id: c.classroom_id || null, overwrite: true,
        });
        overwritten += Number(r?.deleted || 0);
        blocked += Number(r?.skipped || 0);
      }
      message.success(
        `已保存：新增 ${createCount} / 修改 ${changeCount} / 删除 ${deleteCount}` +
        (overwritten ? `，覆盖删除 ${overwritten} 个原时段` : '') +
        (blocked ? `；${blocked} 个已有学员预约的时段未被覆盖` : '')
      );
      resetDrafts();
      load();
    } catch (e) {
      message.error('保存失败：' + e.message);
      load();
    } finally { setSaving(false); }
  };

  // ---------- 快捷排课（本身即是预览，保存生成才写库） ----------
  const buildPreview = () => {
    const tid = Number(effTeacher || teachers[0]?.id);
    const tname = teachers.find((t) => t.id == tid)?.name || '';
    const sh = Number(quick.startHour.split(':')[0]);
    const eh = Number(quick.endHour.split(':')[0]);
    const out = [];
    let n = 0;
    let d = parseLocal(quick.startDate);
    const end = parseLocal(quick.endDate);
    while (d <= end) {
      const dow = d.getDay();
      if (!(quick.weekdaysOnly && (dow === 0 || dow === 6))) {
        for (let h = sh; h < eh; h++) {
          out.push({ kind: 'avail', id: 'pv' + (n++), slot_date: fmt(d), start_time: `${String(h).padStart(2, '0')}:00:00`, end_time: `${String(h + 1).padStart(2, '0')}:00:00`, teacher_id: tid, teacher_name: tname, course_title: null, member_name: null });
        }
      }
      d = addDays(d, 1);
    }
    setPreview({
      teacherId: tid, startDate: quick.startDate, endDate: quick.endDate, startHour: sh, endHour: eh, weekdaysOnly: quick.weekdaysOnly,
      blocks: out, days: Array.from({ length: WINDOW }, (_, i) => addDays(parseLocal(quick.startDate), i)),
    });
  };
  const savePreview = async () => {
    try {
      await api.quickSchedule({
        teacherId: preview.teacherId, startDate: preview.startDate, endDate: preview.endDate,
        startHour: preview.startHour, endHour: preview.endHour, weekdaysOnly: preview.weekdaysOnly,
      });
      setPreview(null);
      setWindowStart(fmt(addDays(parseLocal(preview.startDate), -4)));
      setSelected(preview.startDate);
      setQuick((q) => ({ ...q, msg: '已生成可约时段' }));
      load();
    } catch (e) { message.error('生成失败：' + e.message); }
  };

  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.name }));
  const roomOptions = classrooms.filter((r) => r.status !== 0).map((r) => ({ value: r.id, label: r.name }));

  // ---------- 教室管理 ----------
  const reloadRooms = () => api.classrooms().then(setClassrooms).catch(() => {});
  const addRoom = async () => {
    const name = newRoomName.trim();
    if (!name) return;
    try {
      await api.createClassroom({ name });
      setNewRoomName('');
      reloadRooms();
      message.success('已添加教室');
    } catch (e) { message.error(e.message); }
  };
  const removeRoom = async (r) => {
    try {
      await api.deleteClassroom(r.id);
      reloadRooms();
      message.success(`已删除「${r.name}」，相关排课的教室已清空`);
    } catch (e) { message.error(e.message); }
  };

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>排课管理</Typography.Title>
      <Typography.Paragraph type="secondary">
        {HOUR_START}:00–{HOUR_END}:00 课程表 · <b>所有编辑先记草稿，只有点击「保存全部」才写入数据库</b>
        {canEdit && <> · 单击空白处新增 1 小时，按住上下拖动自选范围 · 拖动块上/下边界改时段 · 悬停点 × 标记删除</>}
      </Typography.Paragraph>

      {/* 顶部排课设置 */}
      <div className="panel" style={{ padding: 16, marginBottom: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12 }}>
        {isAdmin && (
          <div className="field"><label>教师（排课对象）</label>
            <Select style={{ width: '100%' }} allowClear placeholder="全部教师" value={teacherId || undefined}
              onChange={(v) => setTeacherId(v || '')} options={teacherOptions} />
          </div>
        )}
        <div className="field"><label>开始日期</label>
          <AntDatePicker style={{ width: '100%' }} value={quick.startDate ? dayjs(quick.startDate) : null}
            onChange={(d) => setQuick({ ...quick, startDate: d ? d.format('YYYY-MM-DD') : '' })} />
        </div>
        <div className="field"><label>结束日期</label>
          <AntDatePicker style={{ width: '100%' }} value={quick.endDate ? dayjs(quick.endDate) : null}
            onChange={(d) => setQuick({ ...quick, endDate: d ? d.format('YYYY-MM-DD') : '' })} />
        </div>
        <div className="field"><label>起始时间</label>
          <TimePicker style={{ width: '100%' }} format="HH:mm" value={quick.startHour ? toDayjs(parseTime(quick.startHour)) : null}
            onChange={(d) => setQuick({ ...quick, startHour: d ? d.format('HH:mm') : '10:00' })} />
        </div>
        <div className="field"><label>结束时间</label>
          <TimePicker style={{ width: '100%' }} format="HH:mm" value={quick.endHour ? toDayjs(parseTime(quick.endHour)) : null}
            onChange={(d) => setQuick({ ...quick, endHour: d ? d.format('HH:mm') : '21:00' })} />
        </div>
        <div style={{ alignSelf: 'end', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Checkbox checked={quick.weekdaysOnly} onChange={(e) => setQuick({ ...quick, weekdaysOnly: e.target.checked })}>仅工作日</Checkbox>
        </div>
        <div style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
          <Button type="primary" onClick={buildPreview}>⚡ 快捷排课（预览）</Button>
          <Button onClick={() => setRoomMgr(true)}>🏠 教室</Button>
          <Button onClick={() => api.downloadSchedule(quick.startDate, quick.endDate, effTeacher || undefined)}>⬇ 导出课表</Button>
        </div>
        {quick.msg && <div className="page-sub" style={{ margin: 0, gridColumn: '1 / -1' }}>{quick.msg}</div>}
      </div>

      {/* 顶部工具条 */}
      <div className="sched-top">
        <Button icon={<LeftOutlined />} onClick={() => shift(-WINDOW)} />
        <Button icon={<RightOutlined />} onClick={() => shift(WINDOW)} />
        <AntDatePicker
          allowClear={false}
          format="YYYY年M月D日"
          value={dayjs(selected)}
          onChange={(d) => { if (d) { setWindowStart(fmt(addDays(d.toDate(), -4))); setSelected(fmt(d.toDate())); } }}
        />
        <span className="page-sub" style={{ margin: 0 }}>点击表头日期可定位 · 当前选中 {selected}{loading ? ' · 加载中…' : ''}</span>
      </div>

      {/* 新增时段草稿条（松手后选区已经变成网格里的虚线块，这里可继续微调） */}
      {activeCreate && (
        <div className="draft-bar create-bar">
          <span>新增时段草稿 <b>{activeCreate.slot_date}</b>（网格中虚线块）</span>
          <TimePicker format="HH:mm" allowClear={false}
            value={toDayjs(activeCreate.start)}
            onChange={(d) => d && updateCreate(activeCreate.cid, { start: clampHour(parseTime(d.format('HH:mm'))) })} />
          <span>至</span>
          <TimePicker format="HH:mm" allowClear={false}
            value={toDayjs(activeCreate.end)}
            onChange={(d) => d && updateCreate(activeCreate.cid, { end: clampHour(parseTime(d.format('HH:mm'))) })} />
          {isAdmin ? (
            <Select style={{ width: 140 }} value={activeCreate.teacher_id ?? undefined} placeholder="选择教师" options={teacherOptions}
              onChange={(v) => updateCreate(activeCreate.cid, { teacher_id: v })} />
          ) : (
            <Tag color="gold">{teacherName(activeCreate.teacher_id) || '本人'}</Tag>
          )}
          <Select style={{ width: 130 }} value={activeCreate.classroom_id ?? undefined} placeholder="选择教室" allowClear
            options={roomOptions}
            onChange={(v) => updateCreate(activeCreate.cid, { classroom_id: v ?? null })} />
          <Button type="primary" size="small" onClick={() => setActiveCid(null)}>完成</Button>
          <Button size="small" danger onClick={() => markDelete({ kind: 'new', cid: activeCreate.cid })}>撤销新增</Button>
        </div>
      )}

      {/* 统一草稿保存条 */}
      {pendingCount > 0 && (
        <div className="draft-bar">
          <span>待保存草稿：<b>{createCount}</b> 新增 / <b>{changeCount}</b> 修改 / <b>{deleteCount}</b> 删除 —— 目前<b>均未写入数据库</b></span>
          {overwritePreview > 0 && <Tag color="volcano">将覆盖 {overwritePreview} 个已有时段（保存后删除，视为需重排）</Tag>}
          <Button type="primary" size="small" loading={saving} onClick={saveAll}>保存全部</Button>
          <Button size="small" onClick={resetDrafts}>撤销全部</Button>
        </div>
      )}

      {/* 主课程表 */}
      <ScheduleGrid
        days={days} blocks={displayBlocks} canModify={canModify} drafts={drafts}
        selection={selection} defaultTeacherId={defaultTeacherId} classrooms={classrooms}
        onBlockClick={openEditor} onResizeStart={startResize} onDelete={markDelete} onRestore={restore}
        onLanePointerDown={startSelect}
        scrollRef={scrollRef} selected={selected} onSelectDay={scrollToDay} onScroll={onScroll}
      />

      {/* 快捷排课预览 */}
      {preview && (
        <div className="preview-wrap">
          <Typography.Title level={5}>快捷排课预览（未保存）</Typography.Title>
          <Typography.Paragraph type="secondary">共生成 {preview.blocks.length} 个可约时段，确认无误后点击「保存生成」写入课表。</Typography.Paragraph>
          <Space style={{ marginTop: 8, marginBottom: 8 }}>
            <Button type="primary" onClick={savePreview}>保存生成</Button>
            <Button onClick={() => setPreview(null)}>取消</Button>
          </Space>
          <ScheduleGrid days={preview.days} blocks={preview.blocks} canModify={() => false} defaultTeacherId={preview.teacherId} />
        </div>
      )}

      {/* 编辑块弹窗：只写草稿 */}
      <Modal
        open={!!editor}
        title="编辑时段（记入草稿）"
        okText="记入草稿" cancelText="取消"
        onOk={stageEditor} onCancel={() => setEditor(null)}
        okButtonProps={{ disabled: !!editor && editor.end <= editor.start }}
      >
        {editor && (
          <>
            {isAdmin && (
              <div className="field"><label>教师</label>
                <Select style={{ width: '100%' }} value={editor.teacherId || undefined} placeholder="未指定"
                  options={teacherOptions} onChange={(v) => setEditor({ ...editor, teacherId: v ?? '', dirty: true })} />
              </div>
            )}
            <div className="field"><label>教室</label>
              <Select style={{ width: '100%' }} allowClear placeholder="未指定教室" value={editor.classroomId || undefined}
                options={roomOptions} onChange={(v) => setEditor({ ...editor, classroomId: v ?? '', dirty: true })} />
            </div>
            <div className="field"><label>开始时间</label>
              <TimePicker style={{ width: '100%' }} format="HH:mm"
                value={toDayjs(editor.start)}
                onChange={(d) => setEditor({ ...editor, start: clampHour(parseTime(d ? d.format('HH:mm') : '06:00')), dirty: true })} />
            </div>
            <div className="field"><label>结束时间</label>
              <TimePicker style={{ width: '100%' }} format="HH:mm"
                value={toDayjs(editor.end)}
                onChange={(d) => setEditor({ ...editor, end: clampHour(parseTime(d ? d.format('HH:mm') : '07:00')), dirty: true })} />
            </div>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              也可直接拖动块的上 / 下边界调整时间。所有改动都要在页面点击「保存全部」后才会生效。
            </Typography.Paragraph>
          </>
        )}
      </Modal>
      {/* 教室管理 */}
      <Modal open={roomMgr} title="教室 / 琴房管理" footer={null} onCancel={() => setRoomMgr(false)}>
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input placeholder="新教室名称，如 琴房 D" value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)} onPressEnter={addRoom} />
          <Button type="primary" onClick={addRoom}>添加</Button>
        </Space.Compact>
        {classrooms.length === 0 && (
          <Typography.Paragraph type="secondary">还没有教室，先添加一间。</Typography.Paragraph>
        )}
        {classrooms.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f0ece2' }}>
            <span>{r.name}{Number(r.capacity) > 1 ? ` · 可容纳 ${r.capacity} 人` : ''}</span>
            <Button size="small" type="text" danger onClick={() => removeRoom(r)}>删除</Button>
          </div>
        ))}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          删除教室会把已有排课上的教室清空（课次本身保留）。
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
