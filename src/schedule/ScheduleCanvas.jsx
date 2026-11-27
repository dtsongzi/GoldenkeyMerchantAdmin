import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HOUR_PX, TIME_W, LANE_W, WEEK_COL_W, DAY_COL_W, WEEK_CN,
  fmt, weekOf, parseTime, timesOf, toTimeStr, hhmm, snapHour, clamp,
  colorOf, layoutLane, groupLanes, laneOf, laneKeyOf, lanesOfDay,
  conflictKind, conflictLabel, conflictGroups, LESSON_STATUS,
} from './utils.js';

// 课块用 memo 包裹；所有交互走画布层事件委托 + DOM 直接操作，拖拽时零 React 重渲染
const LessonBlock = memo(function LessonBlock({
  lesson, top, height, left, width, color, editable, conflict, showStudents, compact, pendingRemove,
  dense, showBadges,
}) {
  const [st, en] = timesOf(lesson);
  const students = lesson.students || [];
  const status = LESSON_STATUS.find((s) => s.value === lesson.lesson_status);
  const style = {
    top, height, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)`,
    background: color.bg, borderColor: conflict ? '#c4786f' : color.border, color: color.text,
  };
  return (
    <div
      className={`sc-block${editable ? ' editable' : ''}${conflict ? ' conflict' : ''}${compact ? ' compact' : ''}${dense ? ' dense' : ''}${pendingRemove ? ' pending-remove' : ''}`}
      style={style}
      data-id={lesson.id}
      title={`${hhmm(st)}-${hhmm(en)} ${lesson.title || ''}${pendingRemove ? ' · 保存后将被替换移除' : conflict ? ' · 存在资源冲突' : ''}`}
    >
      {pendingRemove && <i className="sc-pending-tag">待移除</i>}
      {compact ? (
        <div className="sc-block-compact">
          <b>{hhmm(st)}–{hhmm(en)}</b> {lesson.title || '未命名课程'}
          {conflict && showBadges && <i className="sc-badge warn" title="教师或教室时间冲突">冲突</i>}
        </div>
      ) : (
        <>
          <div className="sc-block-title">{lesson.title || '未命名课程'}</div>
          <div className="sc-block-line">{lesson.teacher_name || '未指定教师'}{lesson.classroom_name ? ` · ${lesson.classroom_name}` : ''}</div>
          {showStudents && !dense && students.length > 0 && (
            <div className="sc-block-line sc-students">{students.map((s) => s.name).join('、')}</div>
          )}
          {!dense && (
            <div className="sc-block-foot">
              <span>{hhmm(st)}–{hhmm(en)}</span>
              <span className="sc-badges">
                {showBadges && lesson.series_id && <i className="sc-badge series" title="循环系列课程">↻</i>}
                {showBadges && status && status.value !== 'normal' && (
                  <i className="sc-badge" style={{ color: status.color }} title={`课程状态：${status.label}`}>{status.label}</i>
                )}
                {showBadges && conflict && <i className="sc-badge warn" title="教师或教室时间冲突">冲突</i>}
              </span>
            </div>
          )}
        </>
      )}
      {editable && <i className="sc-block-del" data-action="delete" title="删除本节课程（本次编辑内可用「取消编辑」回滚）">×</i>}
      {editable && <div className="sc-handle top" data-edge="top" title="拖动调整开始时间" />}
      {editable && <div className="sc-handle bottom" data-edge="bottom" title="拖动调整结束时间" />}
    </div>
  );
});

export default function ScheduleCanvas({
  days, lessons, allLessons, settings, viewMode, editable, selectedDate,
  teachers, classrooms, conflicts, studentHints, onBlank, onEdit, onMove, onResize,
  onContext, onSelectDate, scrollRef, onDelete,
  onPreview, onPreviewResize, onPreviewCancel,
  pendingNew, pendingRemoveIds, draftDefaults,
}) {
  const hourStart = settings.startHour ?? 7;
  const hourEnd = settings.endHour ?? 21;
  const gridH = (hourEnd - hourStart) * HOUR_PX;
  const [hover, setHover] = useState(null);
  const hoverRef = useRef(null);
  const dragRef = useRef(null);
  const selRef = useRef(null);
  const suppressClick = useRef(false);
  const autoScrollRef = useRef(false);

  const lessonsById = useMemo(() => new Map(lessons.map((l) => [l.id, l])), [lessons]);
  // 教师 / 教室视图：全天统一的资源泳道（每位教师/教室一条，横向并排）
  const globalLanes = useMemo(
    () => groupLanes(lessons, viewMode, teachers, classrooms),
    [lessons, viewMode, teachers, classrooms]
  );
  // 周 / 日视图：同一天有多位教师时按教师拆栏，每位教师一条互不共用的纵向时间线（可在设置里关闭）
  const splitByDay = (viewMode === 'week' || viewMode === 'day') && settings.splitByTeacher !== false;

  // 监听课表可视区宽度，日期列按剩余空间自适应，保证画布横向填满整个区域
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const sc = scrollRef?.current;
    if (!sc) return;
    const update = () => setViewportW(sc.clientWidth || 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [scrollRef]);

  // 按天组织：每天的泳道（周/日视图按教师拆分，每位教师一条独立时间线）+ 泳道内课块索引
  const dayData = useMemo(() => {
    const m = new Map();
    days.forEach((d) => {
      const key = fmt(d);
      const rows = lessons.filter((l) => l.slot_date === key);
      let lanes = splitByDay ? lanesOfDay(rows, viewMode, teachers) : globalLanes;
      // 新建弹窗的草稿若归属当天尚未排课的教师，临时补一条时间线，保证轮廓有落位
      if (splitByDay && pendingNew && pendingNew.date === key) {
        const want = `T${pendingNew.teacher_id ?? 0}`;
        if (!lanes.some((l) => l.key === want)) {
          lanes = [
            ...lanes.filter((l) => l.key !== 'ALL'),
            {
              key: want, value: pendingNew.teacher_id ?? null, kind: 'teacher',
              label: teachers.find((t) => t.id === pendingNew.teacher_id)?.name || '未指定教师',
            },
          ];
        }
      }
      const perLane = new Map(lanes.map((l) => [l.key, []]));
      rows.forEach((l) => {
        const lk = splitByDay ? laneKeyOf(l, viewMode) : laneOf(l, viewMode).key;
        if (!perLane.has(lk)) perLane.set(lk, []);
        perLane.get(lk).push(l);
      });
      m.set(key, { lanes, perLane });
    });
    return m;
  }, [days, lessons, viewMode, splitByDay, globalLanes, teachers, pendingNew]);

  // 一天最多要拆成几条时间线，决定日期列的最小宽度
  const maxLanes = useMemo(
    () => Math.max(1, ...days.map((d) => dayData.get(fmt(d))?.lanes.length || 1)),
    [days, dayData]
  );
  const baseColW = Math.max(viewMode === 'day' ? DAY_COL_W : WEEK_COL_W, maxLanes * LANE_W);
  // 左右各一条时间刻度列（右侧可在设置里关掉）；日期列均分剩余宽度，内容不足时撑满
  const showRightRuler = settings.showRuler !== false;
  const timeColsW = TIME_W * (showRightRuler ? 2 : 1);
  const fitColW = viewportW > timeColsW
    ? Math.floor((viewportW - timeColsW) / Math.max(1, days.length)) : 0;
  const colW = Math.max(baseColW, fitColW);
  const innerW = Math.max(viewportW, timeColsW + days.length * colW);
  const lanesOf = (key) => dayData.get(key)?.lanes || [];
  const laneWOf = (key) => colW / Math.max(1, lanesOf(key).length);
  // 新建草稿应落到的泳道：周/日视图按教师，教室视图按教室；不拆栏时退回唯一泳道
  const draftLaneKey = pendingNew
    ? (splitByDay || viewMode === 'teacher'
      ? `T${pendingNew.teacher_id ?? 0}` : `R${pendingNew.classroom_id ?? 0}`)
    : null;
  const draftLaneIn = (dayLanes) => {
    if (!draftLaneKey) return null;
    if (dayLanes.some((l) => l.key === draftLaneKey)) return draftLaneKey;
    return dayLanes.length === 1 ? dayLanes[0].key : null;
  };

  const hourMarks = useMemo(
    () => Array.from({ length: (hourEnd - hourStart) * 2 }, (_, i) => {
      const h = hourStart + Math.floor(i / 2);
      return { key: i, label: i % 2 ? '30' : `${String(h).padStart(2, '0')}:00`, half: i % 2 === 1, top: i * HOUR_PX / 2 };
    }),
    [hourStart, hourEnd]
  );
  const hourLines = useMemo(
    () => Array.from({ length: hourEnd - hourStart }, (_, i) => i),
    [hourStart, hourEnd]
  );

  // ---------- hover 浮窗（事件委托，单个浮层） ----------
  const onMouseOver = useCallback((e) => {
    const el = e.target.closest?.('.sc-block');
    if (!el) return;
    const id = Number(el.dataset.id);
    if (hoverRef.current === id) return;
    hoverRef.current = id;
    setHover({ id, x: Math.min(e.clientX + 16, window.innerWidth - 300), y: Math.min(e.clientY + 14, window.innerHeight - 230) });
  }, []);
  const onMouseOut = useCallback((e) => {
    const next = e.relatedTarget?.closest?.('.sc-block');
    if (next && Number(next.dataset.id) === hoverRef.current) return;
    hoverRef.current = null;
    setHover(null);
  }, []);

  // ---------- 空白网格：点击 / 拖拽拉区间 ----------
  // 拖拽时按「教师 / 教室 + 时间重叠」实时找出会被替换的旧课，先置灰预览；保存后才真正删除
  const markPending = (idSet) => {
    document.querySelectorAll('.sc-block[data-id]').forEach((el) => {
      // 类名需与 LessonBlock 渲染的 pending-remove 保持一致，拖拽期与弹窗期无缝衔接
      el.classList.toggle('pending-remove', idSet.has(Number(el.dataset.id)));
    });
  };
  const startBlank = (e, date, lane) => {
    if (!editable || e.button !== 0 || dragRef.current || selRef.current) return;
    if (e.target.closest?.('.sc-block') || e.target.closest?.('.sc-draft-preview')) return;
    e.stopPropagation();
    const laneEl = e.currentTarget;
    const rect = laneEl.getBoundingClientRect();
    const anchor = snapHour(hourStart + (e.clientY - rect.top) / HOUR_PX, settings);
    // 新建课的默认资源：教师 / 教室泳道（周/日视图按教师拆栏）以当前泳道为准，其余取顶部表单默认值
    const teacherLane = lane.kind === 'teacher' || viewMode === 'teacher';
    const resources = {
      teacherId: teacherLane && lane.value != null ? Number(lane.value)
        : (draftDefaults?.teacherId ?? null),
      classroomId: (lane.kind === 'room' || viewMode === 'room') && lane.value != null ? Number(lane.value)
        : (draftDefaults?.classroomId ?? null),
    };
    const pendingInfoFor = (a, b) => {
      const cand = {
        slot_date: date, start_time: toTimeStr(a), end_time: toTimeStr(b),
        teacher_id: resources.teacherId, classroom_id: resources.classroomId,
      };
      const pool = allLessons || lessons;
      if (!Array.isArray(pool)) return { ids: new Set(), roomBusy: false };
      const hits = pool.filter((l) => conflictKind(cand, l));
      // 同教师重叠 = 本人课程，可被覆盖（置灰预览）；教师不同还冲突 = 教室被占，必须换教室
      const ids = new Set(hits
        .filter((l) => String(l.teacher_id) === String(resources.teacherId))
        .map((l) => l.id));
      const roomBusy = hits.some((l) => String(l.teacher_id) !== String(resources.teacherId));
      return { ids, roomBusy };
    };
    const session = {
      date, lane, laneEl, anchor,
      startX: e.clientX, startY: e.clientY, moved: false, cur: anchor, resources,
    };
    selRef.current = session;
    document.body.style.userSelect = 'none';
    const selEl = laneEl.querySelector('.sc-sel');
    let lastKey = '';
    const show = (a, b) => {
      selEl.style.display = 'block';
      selEl.style.top = `${(a - hourStart) * HOUR_PX}px`;
      selEl.style.height = `${Math.max(12, (b - a) * HOUR_PX)}px`;
      const key = `${a}-${b}`;
      if (key === lastKey) return;
      lastKey = key;
      const { ids, roomBusy } = pendingInfoFor(a, b);
      selEl.textContent = `${hhmm(a)} – ${hhmm(b)}${ids.size ? ` · 替换 ${ids.size} 节` : ''}${roomBusy ? ' · 教室被占' : ''}`;
      selEl.classList.toggle('warn', roomBusy);
      markPending(ids);
    };
    // 初始预览与「单击空白默认 1 小时」保持一致，避免预览与最终草稿时长不符
    show(anchor, Math.min(hourEnd, anchor + 1));

    const move = (ev) => {
      const s = selRef.current;
      if (!s) return;
      const dx = Math.abs(ev.clientX - s.startX), dy = Math.abs(ev.clientY - s.startY);
      if (!s.moved && dx < 4 && dy < 4) return;
      s.moved = true;
      // 每次都取「当前」泳道矩形换算：拖拽期间页面/容器滚动时，缓存下来的 rect.top 会过期，
      // 一旦指针跑到过期的上边界之外，选区顶部就会瞬间跳到课表最上方。
      const r = s.laneEl.getBoundingClientRect();
      const t = snapHour(hourStart + (ev.clientY - r.top) / HOUR_PX, settings);
      s.cur = t;
      show(Math.min(s.anchor, t), Math.max(s.anchor, t, Math.min(s.anchor, t) + 0.5));
    };
    // commit=false（pointercancel）：只清预览，不新建课程
    const finish = (commit) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      const s = selRef.current;
      selRef.current = null;
      if (s) s.laneEl.querySelector('.sc-sel').style.display = 'none';
      // 拖拽期的 DOM 标记先清空，随后由主页面的 pendingRemoveIds 通过 React 接管置灰
      markPending(new Set());
      if (!s || !commit) return;
      const v = {
        laneValue: s.lane.value,
        teacherId: resources.teacherId, classroomId: resources.classroomId,
      };
      if (!s.moved) {
        const st = s.anchor;
        onPreview?.({ date: s.date, start: st, end: Math.min(hourEnd, st + 1), ...v });
      } else {
        const a = Math.min(s.anchor, s.cur), b = Math.max(s.anchor, s.cur, a + 0.5);
        onPreview?.({ date: s.date, start: a, end: Math.min(hourEnd, b), ...v });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // ---------- 新建草稿区域：拖上下边缘调整时长，再点一次才弹创建弹窗 ----------
  const startDraftResize = (e, edge) => {
    if (!editable || !pendingNew || pendingNew.stage !== 'preview') return;
    e.stopPropagation();
    e.preventDefault();
    const laneEl = e.currentTarget.closest('.sc-lane');
    if (!laneEl) return;
    const orig = { start: pendingNew.start, end: pendingNew.end };
    const startY = e.clientY;
    let raf = 0, lastY = startY;
    const move = (ev) => {
      lastY = ev.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const raw = (lastY - startY) / HOUR_PX;
        const d = settings.snap === false ? Math.round(raw * 4) / 4 : Math.round(raw * 2) / 2;
        let st = orig.start, en = orig.end;
        if (edge === 'top') st = clamp(orig.start + d, hourStart, orig.end - 0.5);
        else en = clamp(orig.end + d, orig.start + 0.5, hourEnd);
        onPreviewResize?.({ start: st, end: en });
      });
    };
    const finish = (commit) => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      // 拖动结束的 click 不应立刻弹出创建弹窗
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // ---------- 拉伸上下边缘 ----------
  const startResize = (e, edge, lesson) => {
    if (!editable) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.target.closest('.sc-block');
    const [origStart, origEnd] = timesOf(lesson);
    const s = { edge, el, startY: e.clientY, origStart, origEnd, delta: 0 };
    dragRef.current = { type: 'resize' };
    document.body.style.userSelect = 'none';
    el.classList.add('sc-resizing');
    // top / height 是 React 渲染出来的内联样式，拖动期间由我们临时改写，
    // 结束时必须还原成「原值」而不是 '' —— 清成 '' 会让块回落到 top:auto，
    // 也就是泳道最上方（用户看到的就是「单元格顶部突然跳到课程表最上方」）。
    const prevTop = el.style.top;
    const prevHeight = el.style.height;
    // 与拖动课块一致：捕获指针，指针移出窗口时不会丢事件、也不会半途卡住
    try { el.setPointerCapture?.(e.pointerId); } catch { /* 部分浏览器不支持 */ }

    let raf = 0, lastY = e.clientY;
    const move = (ev) => {
      lastY = ev.clientY;
      if (!Number.isFinite(lastY)) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const raw = (lastY - s.startY) / HOUR_PX;
        const d = settings.snap === false ? Math.round(raw * 4) / 4 : Math.round(raw * 2) / 2;
        s.delta = d;
        let st = s.origStart, en = s.origEnd;
        if (s.edge === 'top') st = clamp(s.origStart + d, hourStart, s.origEnd - 0.5);
        else en = clamp(s.origEnd + d, s.origStart + 0.5, hourEnd);
        el.style.top = `${(st - hourStart) * HOUR_PX}px`;
        el.style.height = `${Math.max(12, (en - st) * HOUR_PX)}px`;
        s.nextStart = st; s.nextEnd = en;
      });
    };
    // commit=false（pointercancel）：只回滚样式，不提交时长变更
    const finish = (commit) => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      dragRef.current = null;
      el.classList.remove('sc-resizing');
      try { el.releasePointerCapture?.(e.pointerId); } catch { /* 未捕获时忽略 */ }
      const changed = s.nextStart != null && (s.nextStart !== s.origStart || s.nextEnd !== s.origEnd);
      if (!(commit && changed)) {
        // 没有真正改变时长（或手势被打断）：还原到拖动前的内联样式。
        // 注意不能写 ''，否则块会掉到泳道最上方。
        el.style.top = prevTop;
        el.style.height = prevHeight;
        return;
      }
      // 已提交变更：保留拖动结果，等父组件 load() 后用新数据重渲染覆盖，避免闪回旧位置
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      onResize(lesson, { start_time: toTimeStr(s.nextStart), end_time: toTimeStr(s.nextEnd) });
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // ---------- 拖动课块：跨日期 / 跨泳道 / 改时间，实时冲突标红 + 占位预览 ----------
  const startMove = (e, lesson) => {
    if (!editable || e.button !== 0 || dragRef.current || selRef.current) return;
    if (e.target.closest?.('[data-action="delete"]')) return;
    if (e.target.dataset?.edge) { startResize(e, e.target.dataset.edge, lesson); return; }
    e.stopPropagation();
    const el = e.target.closest('.sc-block');
    const [origStart, origEnd] = timesOf(lesson);
    const duration = Math.max(0.5, origEnd - origStart);
    // 抓取点相对课块顶部的小时偏移：拖动时让这一「抓取位置」始终跟着指针，
    // 因此课块不会因为指针在块内偏上/偏下而整块跳动。
    const startLane = el.closest('.sc-lane');
    const startRect = el.getBoundingClientRect();
    const grabOffset = clamp((e.clientY - startRect.top) / HOUR_PX, 0, duration);
    const s = {
      el, lesson, startX: e.clientX, startY: e.clientY, origStart, origEnd, duration, grabOffset,
      refLane: startLane,
      origDate: lesson.slot_date, moved: false, delta: 0, target: null, previewEl: null,
    };
    dragRef.current = { type: 'move' };
    document.body.style.userSelect = 'none';
    // 捕获指针：指针移出窗口/划过其它元素时事件仍然回到这个块，不会出现「拖到一半卡住」
    try { el.setPointerCapture?.(e.pointerId); } catch { /* 部分浏览器不支持 */ }

    const hidePreview = () => {
      if (s.previewEl) { s.previewEl.style.display = 'none'; s.previewEl = null; }
    };
    let raf = 0, lastX = e.clientX, lastY = e.clientY;
    const move = (ev) => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!Number.isFinite(lastX) || !Number.isFinite(lastY)) return;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const dx = lastX - s.startX, dy = lastY - s.startY;
        if (!s.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        if (!s.moved) { s.moved = true; el.classList.add('sc-dragging'); }
        const laneEl = document.elementFromPoint(lastX, lastY)?.closest?.('.sc-lane') || null;
        if (laneEl) s.refLane = laneEl;
        // 时间用「指针相对当前泳道的绝对位置」换算（delta 只用来判断是否开始拖），
        // 拖拽中页面/容器滚动时 rect 会跟着变，坐标始终正确，不会累积漂移。
        const rect = (s.refLane || startLane).getBoundingClientRect();
        const pointerHour = hourStart + (lastY - rect.top) / HOUR_PX - s.grabOffset;
        const st = clamp(snapHour(pointerHour, settings), hourStart, hourEnd - duration);
        const en = st + duration;
        s.delta = st - s.origStart;
        // 关键：浮起块的纵向位移跟着「吸附并夹紧后的时间」走，而不是原始 dy。
        // 否则向上拖过第一小时（或指针越出窗口）时块会跟着手指飞出课表、被容器裁掉，
        // 松手又按夹紧值画回 07:00——看起来就是「单元格顶部突然跳到课表最上方」。
        el.style.transform = `translate(${dx}px, ${(st - s.origStart) * HOUR_PX}px)`;
        const targetDate = laneEl?.dataset.date || s.origDate;
        const targetKind = laneEl?.dataset.kind || '';
        const targetValue = laneEl?.dataset.value === '' || laneEl?.dataset.value == null
          ? null : Number(laneEl.dataset.value);
        // 落到别人的教师泳道 = 改归属教师；落到教室泳道 = 换教室
        const isTeacherLane = targetKind === 'teacher' || viewMode === 'teacher';
        const isRoomLane = targetKind === 'room' || viewMode === 'room';
        s.target = {
          date: targetDate, value: targetValue,
          start: st, end: en, laneEl,
          teacher_id: isTeacherLane ? targetValue : lesson.teacher_id,
          classroom_id: isRoomLane ? targetValue : lesson.classroom_id,
        };
        const candidate = {
          slot_date: targetDate, start_time: toTimeStr(st), end_time: toTimeStr(en),
          teacher_id: s.target.teacher_id, classroom_id: s.target.classroom_id,
        };
        const { self, other } = conflictGroups(candidate, allLessons || lessons, lesson.id, candidate.teacher_id);
        const badOther = other.length > 0;
        // 红：与他人冲突，落位会被拦截；黄：本人时段重叠，可直接覆盖
        el.classList.toggle('sc-drag-conflict', badOther);
        el.classList.toggle('sc-drag-self', self.length > 0 && !badOther);
        hidePreview();
        if (laneEl) {
          const pv = laneEl.querySelector('.sc-drop-preview');
          if (pv) {
            pv.style.display = 'block';
            pv.style.top = `${(st - hourStart) * HOUR_PX}px`;
            pv.style.height = `${Math.max(12, duration * HOUR_PX)}px`;
            // 红 = 教室被占（落位会被拦截）；黄 = 与本人时段重叠（可直接覆盖）
            pv.textContent = badOther ? '教室被占' : (self.length ? '覆盖本人重叠' : '');
            pv.classList.toggle('conflict', badOther);
            pv.classList.toggle('self', !badOther && self.length > 0);
            s.previewEl = pv;
          }
        }
      });
    };
    // commit=false 用于 pointercancel（手势被系统/浏览器打断）：只回滚，不落位，避免「莫名其妙移动了」
    const finish = (commit) => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      dragRef.current = null;
      hidePreview();
      el.classList.remove('sc-dragging', 'sc-drag-conflict', 'sc-drag-self');
      el.style.transform = '';
      try { el.releasePointerCapture?.(e.pointerId); } catch { /* 未捕获时忽略 */ }
      if (!commit || !s.moved) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      const t = s.target;
      if (!t) return;
      const patch = {
        slot_date: t.date, start_time: toTimeStr(t.start), end_time: toTimeStr(t.end),
      };
      if (t.teacher_id !== lesson.teacher_id) patch.teacher_id = t.teacher_id;
      if (t.classroom_id !== lesson.classroom_id) patch.classroom_id = t.classroom_id;
      const changed = patch.slot_date !== s.origDate
        || Math.abs(t.start - s.origStart) > 0.001
        || patch.teacher_id !== undefined || patch.classroom_id !== undefined;
      if (changed) {
        onMove(lesson, patch, {
          slot_date: patch.slot_date, start_time: patch.start_time, end_time: patch.end_time,
          teacher_id: patch.teacher_id ?? lesson.teacher_id,
          classroom_id: patch.classroom_id ?? lesson.classroom_id,
        });
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // 选中日期变化时把该列滚入可视区（表头点击 / 日期选择器跳转）
  useEffect(() => {
    const sc = scrollRef?.current;
    if (!sc || !selectedDate) return;
    const el = sc.querySelector(`.sc-day-head[data-date="${selectedDate}"]`);
    if (!el) return;
    const left = Math.max(0, el.offsetLeft - TIME_W);
    // 右侧时间刻度列固定占位，判断可见范围时把它扣掉
    if (left < sc.scrollLeft || left + colW > sc.scrollLeft + sc.clientWidth - TIME_W) {
      autoScrollRef.current = true;
      sc.scrollTo({ left, behavior: 'smooth' });
      setTimeout(() => { autoScrollRef.current = false; }, 700);
    }
  }, [selectedDate, colW, days.length, scrollRef]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    // 只做程序化定位时抑制选中日期自动滚动，不再横向「加载更多」：视图固定最多一周
    if (el.scrollWidth <= el.clientWidth + 8) return;
  };

  const hoverLesson = hover ? lessonsById.get(hover.id) : null;
  const hoverConflicts = hoverLesson ? (conflicts.get(hoverLesson.id) || []) : [];
  const hoverHints = hoverLesson ? [...(studentHints.get(hoverLesson.id) || [])] : [];

  return (
    <div className={`sc-scroll${editable ? '' : ' readonly'}`} ref={scrollRef}
      onScroll={onScroll} onMouseOver={onMouseOver} onMouseOut={onMouseOut}>
      <div className="sc-inner" style={{ width: innerW }}>
        {/* 表头 */}
        <div className="sc-head">
          <div className="sc-time-head">时间</div>
          {days.map((d, di) => {
            const key = fmt(d);
            const dayLanes = lanesOf(key);
            return (
              <div key={key} className={`sc-day-head${key === selectedDate ? ' sel' : ''}${di === days.length - 1 ? ' last' : ''}`}
                data-date={key} style={{ width: colW, flexGrow: 1 }} onClick={() => onSelectDate(key)}>
                <div className="sc-day-title">
                  <b>{d.getMonth() + 1}/{d.getDate()}</b>
                  <span>周{WEEK_CN[d.getDay()]}</span>
                  {key === fmt(new Date()) && <i className="sc-today">今</i>}
                </div>
                {dayLanes.length > 1 && (
                  <div className="sc-lane-heads">
                    {dayLanes.map((l) => (
                      <div key={l.key} style={{ width: laneWOf(key) }} title={l.label}>{l.label}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {showRightRuler && <div className="sc-time-head right">时间</div>}
        </div>

        {/* 主体：课块交互统一走事件委托，块本身保持纯展示（便于 memo 与拖拽性能） */}
        <div className="sc-body" style={{ height: gridH }}
          onPointerDownCapture={(e) => {
            if (!editable || e.button !== 0) return;
            if (e.target.closest?.('[data-action="delete"]')) return; // 点右上角删除不进入拖拽
            const el = e.target.closest?.('.sc-block');
            if (!el) return;
            const lesson = lessonsById.get(Number(el.dataset.id));
            if (lesson) startMove(e, lesson);
          }}
          onClick={(e) => {
            if (suppressClick.current) return;
            const el = e.target.closest?.('.sc-block');
            if (!el) return;
            const lesson = lessonsById.get(Number(el.dataset.id));
            if (!lesson) return;
            // 右上角 ×：仅编辑态可删除（只读态本来也不渲染删除按钮）
            if (e.target.closest?.('[data-action="delete"]')) {
              if (editable) onDelete?.(lesson);
              return;
            }
            // 只读态点击也弹出详情框（由 openEdit 按编辑态决定是「详情」还是「编辑」）
            onEdit(lesson);
          }}
          onDoubleClick={(e) => {
            if (!editable || e.target.closest?.('[data-action="delete"]')) return;
            const el = e.target.closest?.('.sc-block');
            if (!el) return;
            const lesson = lessonsById.get(Number(el.dataset.id));
            if (lesson) onEdit(lesson);
          }}
          onContextMenu={(e) => {
            if (!editable) return;
            const el = e.target.closest?.('.sc-block');
            if (!el) return;
            e.preventDefault();
            const lesson = lessonsById.get(Number(el.dataset.id));
            if (lesson) onContext(lesson, e.clientX, e.clientY);
          }}>
          <div className="sc-time-col" style={{ height: gridH }}>
            {hourMarks.map((m) => (
              <div key={m.key} className={`sc-time-mark${m.half ? ' half' : ''}`} style={{ height: HOUR_PX / 2 }}>
                {m.label}
              </div>
            ))}
          </div>
          {days.map((d, di) => {
            const key = fmt(d);
            const { lanes: dayLanes, perLane } = dayData.get(key) || { lanes: [], perLane: new Map() };
            const lw = laneWOf(key);
            return (
              <div key={key} className={`sc-day-col${key === selectedDate ? ' sel' : ''}${di === days.length - 1 ? ' last' : ''}`}
                style={{ width: colW, height: gridH, flexGrow: 1 }}>
                <div className="sc-lanes">
                  {dayLanes.map((lane) => {
                    const blocks = perLane.get(lane.key) || [];
                    const layout = layoutLane(blocks);
                    const draftHere = !!pendingNew && key === pendingNew.date && lane.key === draftLaneIn(dayLanes);
                    const previewHere = draftHere && pendingNew.stage === 'preview';
                    const modalHere = draftHere && pendingNew.stage === 'modal';
                    return (
                      <div key={lane.key} className="sc-lane" style={{
                        width: lw,
                        // 教师泳道用该教师的主题色淡淡铺底，一眼能看出每段属于哪位教师
                        background: lane.kind === 'teacher' ? `${colorOf(lane.value).bg}2e` : undefined,
                      }}
                        data-date={key} data-lane={lane.key} data-kind={lane.kind || ''} data-value={lane.value ?? ''}
                        onPointerDown={(e) => startBlank(e, key, lane)}>
                        {/* 每条泳道自带一套刻度线 = 一位教师独立的时间线 */}
                        {hourLines.map((i) => (
                          <div key={`h${i}`}>
                            <div className="sc-hour-line" style={{ top: i * HOUR_PX }} />
                            <div className="sc-half-line" style={{ top: i * HOUR_PX + HOUR_PX / 2 }} />
                          </div>
                        ))}
                        <div className="sc-sel" />
                        <div className="sc-drop-preview" />
                        {blocks.map((b) => {
                          const [st, en] = timesOf(b);
                          const pos = layout.get(b.id) || { left: 0, width: 100 };
                          return (
                            <LessonBlock key={b.id} lesson={b}
                              top={(st - hourStart) * HOUR_PX}
                              height={Math.max(18, (en - st) * HOUR_PX)}
                              left={pos.left} width={pos.width}
                              color={colorOf(b.teacher_id)} editable={editable}
                              conflict={settings.showConflicts !== false && conflicts.has(b.id)}
                              showStudents={settings.showStudents}
                              showBadges={settings.showBadges !== false}
                              dense={!!settings.dense}
                              compact={(en - st) * HOUR_PX < 44}
                              pendingRemove={pendingRemoveIds?.has(b.id)} />
                          );
                        })}
                        {previewHere && (
                          <div className="sc-draft-preview"
                            style={{
                              top: (pendingNew.start - hourStart) * HOUR_PX,
                              height: Math.max(24, (pendingNew.end - pendingNew.start) * HOUR_PX),
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (suppressClick.current) return;
                              onBlank?.({
                                date: pendingNew.date, start: pendingNew.start, end: pendingNew.end,
                                teacherId: pendingNew.teacher_id, classroomId: pendingNew.classroom_id,
                              });
                            }}
                            title="点击创建课程；拖动上下边缘调整时间">
                            <div className="sc-draft-handle top" data-edge="top"
                              onPointerDown={(e) => startDraftResize(e, 'top')} title="拖动调整开始时间" />
                            <div className="sc-draft-plus">+</div>
                            <span className="sc-draft-range">{hhmm(pendingNew.start)} – {hhmm(pendingNew.end)}</span>
                            {pendingNew.removeIds?.length > 0 &&
                              <em className="sc-draft-replace">替换 {pendingNew.removeIds.length} 节</em>}
                            <button type="button" className="sc-draft-close" title="取消"
                              onClick={(e) => { e.stopPropagation(); onPreviewCancel?.(); }}>×</button>
                            <div className="sc-draft-handle bottom" data-edge="bottom"
                              onPointerDown={(e) => startDraftResize(e, 'bottom')} title="拖动调整结束时间" />
                          </div>
                        )}
                        {modalHere && (
                          <div className="sc-draft-outline"
                            style={{
                              top: (pendingNew.start - hourStart) * HOUR_PX,
                              height: Math.max(20, (pendingNew.end - pendingNew.start) * HOUR_PX),
                            }}>
                            <b>{hhmm(pendingNew.start)} – {hhmm(pendingNew.end)}</b>
                            <span>待创建课程</span>
                            {pendingNew.removeIds?.length > 0 &&
                              <em>保存后替换 {pendingNew.removeIds.length} 节冲突课程</em>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* 右侧时间刻度：与左侧对称，横向滚动时固定在区域最右边（可在设置里关闭） */}
          {showRightRuler && (
            <div className="sc-time-col right" style={{ height: gridH }}>
              {hourMarks.map((m) => (
                <div key={m.key} className={`sc-time-mark${m.half ? ' half' : ''}`} style={{ height: HOUR_PX / 2 }}>
                  {m.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 课块 hover 浮窗：独立浮层，不受滚动容器裁剪 */}
      {hoverLesson && hover && (
        <div className="sc-hover-float" style={{ left: hover.x, top: hover.y }}>
          <div className="sc-hover-title">{hoverLesson.title || '未命名课程'}</div>
          <div className="sc-hover-row"><span>时间</span>{hoverLesson.slot_date} {weekOf(hoverLesson.slot_date)} {String(hoverLesson.start_time).slice(0, 5)}–{String(hoverLesson.end_time).slice(0, 5)}</div>
          <div className="sc-hover-row"><span>教师</span>{hoverLesson.teacher_name || '未指定'}</div>
          <div className="sc-hover-row"><span>教室</span>{hoverLesson.classroom_name || '未指定'}</div>
          <div className="sc-hover-row"><span>学生</span>{(hoverLesson.students || []).length ? hoverLesson.students.map((s) => s.name).join('、') : '未安排'}</div>
          <div className="sc-hover-row"><span>状态</span>{LESSON_STATUS.find((s) => s.value === hoverLesson.lesson_status)?.label || '正常'}{hoverLesson.series_id ? ' · 循环系列' : ' · 单次课'}</div>
          {hoverLesson.remark && <div className="sc-hover-row"><span>备注</span>{hoverLesson.remark}</div>}
          {hoverConflicts.map((c, i) => (
            <div key={i} className="sc-hover-alert">⚠ {conflictLabel(c.kind)}：与「{c.with.title || '课程'}」{String(c.with.start_time).slice(0, 5)}–{String(c.with.end_time).slice(0, 5)} 重叠</div>
          ))}
          {hoverHints.map((h, i) => <div key={`h${i}`} className="sc-hover-hint">· {h}</div>)}
          {editable && <div className="sc-hover-tip">单击编辑 · 拖动移动 · 拖上下边缘改时长 · 右键更多</div>}
        </div>
      )}
    </div>
  );
}
