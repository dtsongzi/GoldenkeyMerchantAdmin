import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Select, Space, Tag, Typography, Modal, Input,
  DatePicker, Segmented, Switch, InputNumber, Empty, App as AntApp, Tooltip,
} from 'antd';
import {
  LeftOutlined, RightOutlined, EditOutlined, CheckOutlined, CloseOutlined,
  DownloadOutlined, PrinterOutlined, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, currentUser } from '../api.js';
import {
  DEFAULT_SETTINGS, REPEAT_OPTIONS, repeatLabel,
  fmt, addDays, parseLocal, parseTime, toTimeStr, timeOverlap, hhmm,
  buildConflictMap, buildStudentHints, weekOf, conflictGroups, conflictDomains,
} from '../schedule/utils.js';
import ScheduleCanvas from '../schedule/ScheduleCanvas.jsx';
import LessonModal from '../schedule/LessonModal.jsx';
import '../schedule/schedule.css';

const SETTINGS_KEY = 'gk_schedule_settings';
const loadSettings = () => {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
};
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));

export default function Schedule({ user }) {
  const { message, modal } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const myTeacherId = user?.teacherId || currentUser()?.teacherId;
  const canEdit = isAdmin || role === 'teacher';

  const today = new Date();
  const [settings, setSettings] = useState(loadSettings);
  const [viewMode, setViewMode] = useState('week');
  const [editing, setEditing] = useState(false);
  const [windowStart, setWindowStart] = useState(fmt(mondayOf(today)));
  const [selectedDate, setSelectedDate] = useState(fmt(today));

  const [teachers, setTeachers] = useState([]);
  const [classrooms, setClassrooms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [members, setMembers] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState({ teacherId: undefined, classroomId: undefined, studentId: undefined });
  // 学期：排课必须落在单个学期范围内，不得跨学期
  const [semesters, setSemesters] = useState([]);
  const [activeSemesterId, setActiveSemesterId] = useState(undefined);
  const activeSem = useMemo(
    () => semesters.find((s) => String(s.id) === String(activeSemesterId)),
    [semesters, activeSemesterId]
  );
  // 编辑态的课程模板预设：点击课表新建时预填，重复规则用于自动向后排课
  const [template, setTemplate] = useState({
    teacherId: undefined, courseId: undefined, classroomId: undefined,
    repeat: 'none', remark: '',
  });
  const clampToSem = (s) => {
    if (!activeSem || !s) return s;
    return s < activeSem.start_date ? activeSem.start_date : (s > activeSem.end_date ? activeSem.end_date : s);
  };
  // 课表窗口起点：周视图定位到所在周周一，再把整周夹在学期范围内。
  // 学期开头/结尾那几天若不足一整周，就从学期边界起往后/往前铺满一周，
  // 避免跨界的日期列被过滤后「只剩一两天」。
  const weekStartFor = (dateStr, mode) => {
    const d = parseLocal(dateStr);
    if (mode === 'day') return fmt(d);
    const count = 7;
    const monday = mondayOf(d);
    if (!activeSem) return fmt(monday);
    const weekEnd = addDays(monday, count - 1);
    if (fmt(monday) < activeSem.start_date) {
      // 所在周横跨学期开始日：从学期第一天起铺满一周
      return fmt(parseLocal(activeSem.start_date));
    }
    if (fmt(weekEnd) > activeSem.end_date) {
      // 所在周横跨学期结束日：往前倒推，让最后一天正好是学期结束日
      return fmt(addDays(parseLocal(activeSem.end_date), -(count - 1)));
    }
    return fmt(monday);
  };
  const [editor, setEditor] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  // 拖拽新建的草稿：弹窗期间在画布上画轮廓，并置灰「保存后会被替换」的冲突课
  const [pendingNew, setPendingNew] = useState(null);
  const [conflictModal, setConflictModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [ctx, setCtx] = useState(null);
  // 本次编辑会话：进入编辑时存一份快照，取消编辑可整体回滚
  const [changes, setChanges] = useState(0);

  const scrollRef = useRef(null);
  const sessionRef = useRef(null);
  const lessonsRef = useRef([]);
  lessonsRef.current = lessons;

  const daysCount = viewMode === 'day' ? 1 : 7;   // 视图固定最多一周，不再横向扩展
  const rawDays = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(parseLocal(windowStart), i)),
    [windowStart, daysCount]
  );
  // 展示范围严格收敛在选中学期内：跨学期边界的日期列直接不渲染
  const days = useMemo(() => {
    if (!activeSem) return rawDays;
    const inSem = rawDays.filter((d) => {
      const s = fmt(d);
      return s >= activeSem.start_date && s <= activeSem.end_date;
    });
    if (inSem.length) return inSem;
    // 防御：windowStart 仍落在学期外时，用同一套定位规则重新铺一周，避免退化成单日
    const anchor = parseLocal(weekStartFor(clampToSem(selectedDate), viewMode));
    return Array.from({ length: daysCount }, (_, i) => addDays(anchor, i))
      .filter((d) => {
        const s = fmt(d);
        return s >= activeSem.start_date && s <= activeSem.end_date;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawDays, activeSem, selectedDate, viewMode, daysCount]);
  const rangeFrom = fmt(days[0]);
  const rangeTo = fmt(days[days.length - 1]);

  // ---------- 数据 ----------
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 不传筛选条件：拉取窗口内全量，冲突检测才准确；筛选只在前端做展示过滤
      const rows = await api.lessons({ from: rangeFrom, to: rangeTo });
      setLessons(rows || []);
      return rows || [];
    } catch (e) {
      message.error('课表加载失败：' + e.message);
      setLessons([]);
      return [];
    } finally { setLoading(false); }
  }, [rangeFrom, rangeTo, message]);

  useEffect(() => { api.teachers().then(setTeachers).catch(() => {}); }, []);
  useEffect(() => { api.classrooms().then(setClassrooms).catch(() => {}); }, []);
  // 学期：仅启用学期；默认选中当前学期
  useEffect(() => {
    api.semesters().then((rows) => {
      const enabled = (rows || []).filter((s) => s.status === 1);
      setSemesters(enabled);
      const cur = enabled.find((s) => s.is_current === 1);
      if (cur) setActiveSemesterId((prev) => prev || cur.id);
    }).catch(() => setSemesters([]));
  }, []);
  useEffect(() => {
    const p = isAdmin ? api.listCourses() : api.teacherCourses();
    p.then((rows) => setCourses((rows || []).filter((c) => c.status === 1))).catch(() => setCourses([]));
  }, [isAdmin]);
  useEffect(() => {
    const p = isAdmin ? api.listMembers() : api.teacherStudents();
    p.then((rows) => setMembers(rows || [])).catch(() => setMembers([]));
  }, [isAdmin]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rangeFrom, rangeTo]);

  // 模板默认值：教师账号固定本人，管理员取第一位；课程/教室取第一项
  useEffect(() => {
    setTemplate((t) => ({
      ...t,
      teacherId: t.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId) || undefined,
      courseId: t.courseId || courses[0]?.id || undefined,
      classroomId: t.classroomId || classrooms[0]?.id || undefined,
    }));
  }, [teachers, courses, classrooms, isAdmin, myTeacherId]);

  // 切换学期：日期锚点收敛到新学期；若正在编辑则先退出（避免跨学期遗留草稿）
  useEffect(() => {
    if (!activeSem) return;
    if (sessionRef.current) {
      sessionRef.current = null;
      setChanges(0);
      setEditing(false);
      setPendingNew(null);
      setEditor(null);
      setCtx(null);
      message.info('已切换学期，编辑模式已退出');
    }
    setSelectedDate((prev) => clampToSem(prev));
    setWindowStart((prev) => weekStartFor(clampToSem(prev), viewMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSem?.id, activeSem?.start_date, activeSem?.end_date]);

  useEffect(() => {
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('resize', close); };
  }, []);

  const conflicts = useMemo(() => buildConflictMap(lessons), [lessons]);
  const studentHints = useMemo(() => buildStudentHints(lessons), [lessons]);
  const displayLessons = useMemo(() => lessons.filter((l) => {
    if (filter.teacherId && String(l.teacher_id) !== String(filter.teacherId)) return false;
    if (filter.classroomId && String(l.classroom_id) !== String(filter.classroomId)) return false;
    if (filter.studentId && !(l.students || []).some((s) => String(s.id) === String(filter.studentId))) return false;
    return true;
  }), [lessons, filter]);
  // 冲突域：同一教师（或同一教室）+ 同一时段为一处冲突；课程名不参与判定
  const domains = useMemo(() => conflictDomains(displayLessons), [displayLessons]);
  const conflictCount = domains.length;
  const conflictRows = domains;

  // ---------- 编辑会话（进入编辑存快照 → 取消编辑整体回滚 / 完成编辑保留） ----------
  const snapshotAll = () => lessonsRef.current.map((r) => ({
    ...r, studentIds: (r.students || []).map((s) => s.id),
  }));

  const enterEdit = () => {
    sessionRef.current = { base: snapshotAll(), changes: 0, createdIds: [] };
    setChanges(0);
    setEditing(true);
  };
  const finishEdit = () => {
    sessionRef.current = null;
    setChanges(0);
    setEditing(false);
    message.success('已保存本次编辑');
  };
  const cancelEdit = () => {
    const n = sessionRef.current?.changes || 0;
    const exit = () => { sessionRef.current = null; setChanges(0); setEditing(false); };
    if (!n) { exit(); return; }
    modal.confirm({
      title: '放弃本次编辑？',
      content: `本次编辑共 ${n} 处改动。取消后课表将回到进入编辑前的状态：新增的课程会被删除，被修改、被删除的课程会恢复。`,
      okText: '放弃改动并退出', cancelText: '继续编辑', okButtonProps: { danger: true },
      onOk: async () => {
        const base = sessionRef.current?.base || [];
        // 重复规则可能把课程排到当前视图之外，回滚时也要一并删除
        const ids = [...new Set([
          ...lessonsRef.current.map((l) => l.id),
          ...(sessionRef.current?.createdIds || []),
        ])];
        setBusy(true);
        try {
          await api.restoreLessons({ ids, lessons: base });
          await load();
          exit();
          message.success('已取消本次编辑，课表已恢复');
        } catch (e) {
          message.error('恢复失败：' + e.message);
        } finally { setBusy(false); }
      },
    });
  };

  const mutate = async (label, fn) => {
    setBusy(true);
    try {
      const res = await fn();
      await load();
      if (sessionRef.current) {
        sessionRef.current.changes += 1;
        setChanges(sessionRef.current.changes);
      }
      return res;
    } catch (e) {
      message.error(`${label}失败：${e.message}`);
      throw e;
    } finally { setBusy(false); }
  };

  // ---------- 冲突确认 ----------
  // 分类：self = 与本人（同教师）时段重叠，可直接覆盖；other = 与其他教师冲突，仅提示不可覆盖
  const classifyConflicts = (candidate, excludeId) => {
    const tid = candidate.teacher_id;
    // 注意参数顺序：conflictGroups(候选课, 现有课程数组, 排除 id, 归属教师)
    return conflictGroups(candidate, lessonsRef.current, excludeId, tid);
  };
  const conflictsFor = (candidate) => classifyConflicts(candidate, undefined).self.map((l) => l.id);

  // 「他人冲突」只可能是教室冲突（同教师重叠已归入 self，可直接覆盖），
  // 所以提示必须点名是哪间教室、被谁占用，而不是笼统说「与其他教师冲突」。
  const roomLabel = (id) => classrooms.find((c) => String(c.id) === String(id))?.name || '该教室';
  const roomClashText = (other, candidate) => {
    const who = [...new Set(other.map((l) => l.teacher_name).filter(Boolean))].join('、') || '其他教师';
    const t = other[0];
    const span = `${String(t.start_time).slice(0, 5)}–${String(t.end_time).slice(0, 5)}`;
    return `教室「${roomLabel(candidate.classroom_id)}」${span} 已被 ${who} 占用`;
  };
  // 该时段还能用的空闲教室（用于给出可执行的替代方案）
  const freeRoomAt = (candidate) => classrooms.find((c) => c.status !== 0
    && String(c.id) !== String(candidate.classroom_id)
    && !lessonsRef.current.some((l) => l.slot_date === candidate.slot_date
      && String(l.classroom_id) === String(c.id) && timeOverlap(l, candidate)));

  const confirmIfConflicts = (candidate, excludeId, action) => {
    const { self, other } = classifyConflicts(candidate, excludeId);
    if (other.length) {
      const free = freeRoomAt(candidate);
      message.warning(
        `无法保存：${roomClashText(other, candidate)}${free ? `，可改用「${free.name}」或调整时间` : '，该时段暂无空闲教室，请调整时间'}`
      );
      return;
    }
    // 仅本人时段重叠：可直接覆盖保存（冲突课块标红提示）
    if (self.length) message.info(`与 ${self.length} 节本人课程时段重叠，已保存（课表将标红提示）`);
    action();
  };

  // ---------- 课块交互 ----------
  // 与候选新课存在「教师 / 教室 + 时间重叠」冲突的现有课程（保存时会被移除替换）
  const draftCandidate = (d) => ({
    slot_date: d.date, start_time: toTimeStr(d.start), end_time: toTimeStr(d.end),
    teacher_id: d.teacher_id, classroom_id: d.classroom_id,
  });
  const closeEditor = () => { setEditor(null); setPendingNew(null); };

  // 编辑态新建分两步：先在画布上落一个可拉伸的「+」区域，再点它才弹创建弹窗
  const draftFrom = (v) => ({
    date: v.date, start: v.start, end: v.end,
    teacher_id: v.teacherId ?? template.teacherId ?? (isAdmin ? teachers[0]?.id : myTeacherId) ?? null,
    classroom_id: v.classroomId ?? template.classroomId ?? classrooms[0]?.id ?? null,
  });
  const previewNew = (v) => {
    if (!editing) return;
    const draft = draftFrom(v);
    setEditor(null);
    setPendingNew({ ...draft, stage: 'preview', removeIds: conflictsFor(draftCandidate(draft)) });
  };
  const resizePreview = ({ start, end }) => {
    setPendingNew((p) => {
      if (!p || p.stage !== 'preview') return p;
      const draft = { ...p, start, end };
      return { ...draft, removeIds: conflictsFor(draftCandidate(draft)) };
    });
  };
  const cancelPreview = () => setPendingNew(null);
  const openNew = (v) => {
    if (!editing) return;
    const draft = draftFrom(v);
    setPendingNew({ ...draft, stage: 'modal', removeIds: conflictsFor(draftCandidate(draft)) });
    // 关键：把拖拽落点所在泳道的教师 / 教室作为弹窗初值，
    // 否则周视图会回落到顶部表单的默认教师，建出来的课跑到别人的泳道里。
    setEditor({
      lesson: null,
      initial: {
        date: draft.date, start: draft.start, end: draft.end,
        teacherId: draft.teacher_id, classroomId: draft.classroom_id,
      },
    });
    setEditorKey((k) => k + 1);
  };
  const openEdit = (lesson) => {
    // 只读态点击课程弹出「详情」，编辑态才弹出「编辑」表单
    setPendingNew(null);
    setEditor({ lesson, initial: null, readOnly: !editing });
    setEditorKey((k) => k + 1);
    setCtx(null);
  };
  // 弹窗内改教师 / 教室 / 日期 / 时段时，画布轮廓与置灰同步刷新
  const onDraftChange = (f) => {
    setPendingNew((p) => {
      if (!p) return p;
      const draft = {
        date: f.slot_date, start: f.start, end: f.end,
        teacher_id: f.teacher_id ?? null, classroom_id: f.classroom_id ?? null,
      };
      return { ...draft, stage: p.stage || 'modal', removeIds: conflictsFor(draftCandidate(draft)) };
    });
  };
  const pendingRemoveIds = useMemo(
    () => new Set(editor?.lesson ? [] : (pendingNew?.removeIds || [])),
    [editor, pendingNew]
  );

  // 新建草稿的实时冲突情况：本人重叠（会被替换）与教室被占（必须处理）分开呈现
  const draftClash = useMemo(() => {
    if (!pendingNew || editor?.lesson) return null;
    const candidate = draftCandidate(pendingNew);
    const { self, other } = conflictGroups(candidate, lessons, undefined, candidate.teacher_id);
    const free = other.length ? freeRoomAt(candidate) : null;
    return {
      selfCount: self.length,
      roomText: other.length ? roomClashText(other, candidate) : '',
      freeRoom: free ? { id: free.id, name: free.name } : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNew, editor, lessons, classrooms]);
  const draftDefaults = useMemo(() => ({
    teacherId: template.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId) || null,
    classroomId: template.classroomId || classrooms[0]?.id || null,
  }), [template, teachers, classrooms, isAdmin, myTeacherId]);
  const editorMeta = useMemo(() => ({
    teachers, classrooms, courses, members, isAdmin, myTeacherId, settings,
    defaultTeacherId: editor?.initial?.laneValue && viewMode === 'teacher' ? Number(editor.initial.laneValue)
      : (template.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId)),
    defaultClassroomId: editor?.initial?.laneValue && viewMode === 'room' ? Number(editor.initial.laneValue)
      : (template.classroomId || classrooms[0]?.id),
    defaultCourseId: template.courseId,
    defaultCourseTitle: courses.find((c) => c.id === template.courseId)?.title || '',
    defaultRemark: template.remark,
    defaultRepeat: template.repeat,
    semesters,
    defaultSemesterId: activeSemesterId,
  }), [teachers, classrooms, courses, members, isAdmin, myTeacherId, settings, editor, viewMode, template, semesters, activeSemesterId]);

  const seriesCount = editor?.lesson?.series_id
    ? lessons.filter((l) => l.series_id === editor.lesson.series_id).length : 0;

  // 按模板重复规则算出「创建日期之后、学期结束之前」的日期；往前的日期不碰
  const repeatDatesAfter = (baseDate, repeat) => {
    if (repeat === 'none' || !activeSem) return [];
    const out = [];
    if (repeat === 'weekly') {
      let d = addDays(parseLocal(baseDate), 7);
      while (fmt(d) <= activeSem.end_date && out.length < 200) {
        const s = fmt(d);
        if (s >= activeSem.start_date) out.push(s);
        d = addDays(d, 7);
      }
      return out;
    }
    // 每月重复：按「每月同一日」顺延；遇小月没有该日则取当月最后一天
    const base = parseLocal(baseDate);
    const day = base.getDate();
    let y = base.getFullYear(), m = base.getMonth() + 1;
    while (out.length < 40) {
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      const last = new Date(y, m, 0).getDate();
      const s = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
      if (s > activeSem.end_date) break;
      if (s >= activeSem.start_date) out.push(s);
    }
    return out;
  };
  // 向后复制课程：除日期外完全沿用第一节的信息；重叠仍走现有覆盖规则
  // （同一教师时段重叠 → 先删旧课再建；其他教师占用教室 → 跳过，服务端也不允许覆盖）
  const createRepeatedCopies = async (body, dates) => {
    if (!dates.length) return { created: 0, replaced: 0, skipped: 0, ids: [] };
    let pool = await api.lessons({ from: dates[0], to: dates[dates.length - 1] }).catch(() => []);
    let created = 0, replaced = 0, skipped = 0;
    const ids = [];
    for (const date of dates) {
      const candidate = {
        slot_date: date, start_time: body.start_time, end_time: body.end_time,
        teacher_id: body.teacher_id, classroom_id: body.classroom_id,
      };
      const { self, other } = conflictGroups(candidate, pool, undefined, candidate.teacher_id);
      if (other.length) { skipped += 1; continue; }
      const dropIds = self.map((l) => l.id);
      if (dropIds.length) {
        await api.deleteLessons(dropIds);
        pool = pool.filter((l) => !dropIds.includes(l.id));
      }
      const r = await api.createLesson({ ...body, slot_date: date, semester_id: activeSemesterId });
      if (r?.id) ids.push(r.id);
      pool.push({ ...candidate, id: r?.id, title: body.title });
      created += 1;
      replaced += dropIds.length;
    }
    return { created, replaced, skipped, ids };
  };

  const submitEditor = async (form) => {
    const { scope, repeat, ...body } = form;
    if (!editor.lesson) {
      // 拖拽新建：弹窗期间冲突旧课已在画布上置灰预览（仅本人冲突可被替换）
      const candidate = { slot_date: body.slot_date, start_time: body.start_time, end_time: body.end_time,
        teacher_id: body.teacher_id, classroom_id: body.classroom_id };
      const { self, other } = classifyConflicts(candidate, undefined);
      if (other.length) {
        const free = freeRoomAt(candidate);
        message.warning(
          `无法创建：${roomClashText(other, candidate)}${free ? `，可改用「${free.name}」或调整时间` : '，该时段暂无空闲教室，请调整时间'}`
        );
        return;
      }
      const removeIds = self.map((l) => l.id);
      const dates = repeatDatesAfter(body.slot_date, repeat);
      try {
        const r = await mutate(
          removeIds.length ? `新建课程（替换 ${removeIds.length} 节本人冲突课）` : '新建课程',
          async () => {
            if (removeIds.length) await api.deleteLessons(removeIds);
            const created = await api.createLesson(body);
            const repeated = dates.length ? await createRepeatedCopies(body, dates) : null;
            return { created, repeated };
          }
        );
        if (sessionRef.current) {
          const newIds = [r?.created?.id, ...(r?.repeated?.ids || [])].filter(Boolean);
          sessionRef.current.createdIds.push(...newIds);
        }
        closeEditor();
        const repeated = r?.repeated;
        message.success(
          `课程已创建${removeIds.length ? `，已移除 ${removeIds.length} 节本人冲突课程` : ''}` +
          (repeated?.created
            ? `；按${repeatLabel(repeat)}向后排 ${repeated.created} 节（覆盖 ${repeated.replaced} 节，跳过 ${repeated.skipped} 节教室冲突）`
            : '')
        );
      } catch { /* mutate 已提示 */ }
      return;
    }
    if (scope === 'series') {
      const ids = lessons.filter((l) => l.series_id === editor.lesson.series_id).map((l) => l.id);
      await mutate('修改整个系列', () => api.updateLessonSeries(editor.lesson.series_id, body));
      closeEditor();
      message.success(`已统一修改 ${ids.length} 节课`);
      return;
    }
    const candidate = { slot_date: body.slot_date, start_time: body.start_time, end_time: body.end_time,
      teacher_id: body.teacher_id, classroom_id: body.classroom_id };
    confirmIfConflicts(candidate, editor.lesson.id, async () => {
      try {
        await mutate('修改课程', () => api.updateLesson(editor.lesson.id, body));
        closeEditor();
        message.success('课程已更新');
      } catch { /* mutate 已提示 */ }
    });
  };

  const handleMove = (lesson, patch, candidate) => {
    confirmIfConflicts(candidate, lesson.id, () => {
      mutate('移动课程', () => api.updateLesson(lesson.id, patch)).catch(() => {});
    });
  };
  const handleResize = (lesson, patch) => {
    const candidate = {
      slot_date: lesson.slot_date, start_time: patch.start_time, end_time: patch.end_time,
      teacher_id: lesson.teacher_id, classroom_id: lesson.classroom_id,
    };
    confirmIfConflicts(candidate, lesson.id, () => {
      mutate('调整课程时长', () => api.updateLesson(lesson.id, patch)).catch(() => {});
    });
  };
  // 删除直接生效（课块右上角 × / 右键菜单 / 弹窗内按钮共用）；编辑期内可用「取消编辑」整体回滚
  const handleDelete = async (lesson) => {
    closeEditor();
    setCtx(null);
    try {
      await mutate('删除课程', () => api.deleteLesson(lesson.id));
      message.info('课程已删除，本次编辑内可点击「取消编辑」恢复');
    } catch { /* mutate 已提示 */ }
  };
  const handleDeleteSeries = async (seriesId) => {
    const ids = lessons.filter((l) => l.series_id === seriesId).map((l) => l.id);
    closeEditor();
    await mutate('删除整个系列', () => api.deleteLessonSeries(seriesId)).catch(() => {});
  };
  const handleDuplicate = async (lesson) => {
    setCtx(null);
    await mutate('复制课程', () => api.duplicateLesson(lesson.id)).catch(() => {});
  };

  // ---------- 导航 / 视图 / 导出 / 打印 ----------
  const shift = (n) => {
    const from = clampToSem(windowStart);
    const d = addDays(parseLocal(from), n);
    const date = clampToSem(fmt(d));
    setSelectedDate(date);
    setWindowStart(weekStartFor(date, viewMode));
  };
  const changeView = (v) => {
    setViewMode(v);
    // 始终以当前选中日期为锚点定位，学期边界处保证仍是完整一周
    setWindowStart(weekStartFor(clampToSem(selectedDate), v));
  };
  const jumpTo = (d) => {
    if (!d) return;
    const date = clampToSem(d.format('YYYY-MM-DD'));
    setSelectedDate(date);
    setWindowStart(weekStartFor(date, viewMode));
  };
  const exportExcel = async () => {
    try {
      await api.exportLessons({
        from: rangeFrom, to: rangeTo,
        teacherId: filter.teacherId, classroomId: filter.classroomId, studentId: filter.studentId,
      });
      message.success('课表已导出（Excel 可直接打开）');
    } catch (e) { message.error('导出失败：' + e.message); }
  };

  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.name }));
  const roomOptions = classrooms.filter((r) => r.status !== 0).map((r) => ({ value: r.id, label: r.name }));
  const courseOptions = courses.map((c) => ({ value: c.id, label: `${c.title}${c.duration_min ? ` · ${c.duration_min}min` : ''}` }));
  const memberOptions = members.map((m) => ({ value: m.id, label: m.name }));
  const hourOptions = Array.from({ length: 25 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));

  return (
    <div className="sc-page">
      {/* 标题行 */}
      <div className="sc-head-bar sc-noprint">
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>排课管理</Typography.Title>
          <div className="sc-subtitle">
            课程表 {settings.startHour}:00–{settings.endHour}:00 ·{' '}
            {editing
              ? '编辑中：点空白拉出区域 → 再点中间的「+」创建课程；可拖上下边缘调整，选重复会自动向后排课'
              : '当前为只读查看模式，只有当前学期可编辑；点击课表工具栏「编辑课表」后可调整课程'}
          </div>
        </div>
      </div>

      {/* 学期选择条：完整展示名称与日期范围；非当前学期只读 */}
      <div className="sc-semester-bar sc-noprint">
        <span className="sc-semester-label">学期</span>
        {semesters.length ? semesters.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`sc-sem-chip${String(s.id) === String(activeSemesterId) ? ' active' : ''}`}
            onClick={() => setActiveSemesterId(s.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveSemesterId(s.id); }}
          >
            <b>{s.name}</b>
            <span>{s.start_date} ~ {s.end_date}</span>
            {s.is_current === 1 && <Tag color="green">当前</Tag>}
          </div>
        )) : <span className="sc-sem-empty">请先在「学期管理」创建学期</span>}
      </div>

      {/* 课程模板预设：仅编辑态展示 */}
      {editing && (
        <div className="sc-quick sc-template sc-noprint">
          <div className="sc-quick-title"><b>课程模板预设</b><span>新建课程时自动带入；重复规则仅在创建后按学期范围向后排课，不改动之前的日期</span></div>
          <div className="sc-quick-fields">
            <div className="sc-qf"><label>上课教师 {!isAdmin && '（本人）'}</label>
              {isAdmin ? (
                <Select placeholder="选择教师" options={teacherOptions} value={template.teacherId}
                  onChange={(v) => setTemplate({ ...template, teacherId: v })} />
              ) : (
                <Input disabled value={teachers.find((t) => t.id === myTeacherId)?.name || '本人'} title="教师账号只能排自己的课程" />
              )}
            </div>
            <div className="sc-qf"><label>课程</label>
              <Select placeholder="选择课程" options={courseOptions} value={template.courseId}
                onChange={(v) => setTemplate({ ...template, courseId: v })} />
            </div>
            <div className="sc-qf"><label>教室</label>
              <Select placeholder="选择教室" options={roomOptions} value={template.classroomId}
                onChange={(v) => setTemplate({ ...template, classroomId: v })} />
            </div>
            <div className="sc-qf"><label>重复</label>
              <Select options={REPEAT_OPTIONS} value={template.repeat}
                onChange={(v) => setTemplate({ ...template, repeat: v })} />
            </div>
            <div className="sc-qf wide"><label>备注</label>
              <Input placeholder="如：带教材" value={template.remark}
                onChange={(e) => setTemplate({ ...template, remark: e.target.value })} />
            </div>
          </div>
          <div className="sc-quick-actions">
            <span className="sc-quick-note">
              {activeSem
                ? `当前学期：${activeSem.name}（${activeSem.start_date} ~ ${activeSem.end_date}）`
                : '尚未选择学期，无法排课'}
              {' · '}在课表空白拉出区域后，再点区域中央的「+」创建课程
            </span>
          </div>
        </div>
      )}

      {/* 冲突汇总条 */}
      {conflictCount > 0 && settings.showConflictBar !== false && (
        <div className="sc-alert sc-noprint">
          <span>⚠ 当前视图内有 <b>{conflictCount}</b> 处冲突（同一教师或同一教室在同一时段重复占用，课程名不参与判定）</span>
          <Button size="small" type="link" onClick={() => setConflictModal(true)}>查看冲突明细</Button>
        </div>
      )}

      {/* 工具栏 */}
      <div className="sc-toolbar sc-noprint">
        <Space size={4}>
          <Button icon={<LeftOutlined />} onClick={() => shift(-(viewMode === 'day' ? 1 : 7))} title="上一区间" />
          <Button icon={<RightOutlined />} onClick={() => shift(viewMode === 'day' ? 1 : 7)} title="下一区间" />
          <DatePicker allowClear={false} format="YYYY年M月D日" style={{ width: 158 }}
            value={dayjs(selectedDate)} onChange={jumpTo}
            disabledDate={(d) => activeSem
              ? !!d && (d.format('YYYY-MM-DD') < activeSem.start_date || d.format('YYYY-MM-DD') > activeSem.end_date)
              : false} />
        </Space>
        <Segmented value={viewMode} onChange={changeView} options={[
          { label: '周视图', value: 'week' }, { label: '日视图', value: 'day' },
          { label: '教师视图', value: 'teacher' }, { label: '教室视图', value: 'room' },
        ]} />
        <div className="sc-filters">
          {isAdmin && (
            <Select allowClear placeholder="按教师筛选" style={{ width: 130 }} options={teacherOptions}
              value={filter.teacherId} onChange={(v) => setFilter({ ...filter, teacherId: v })} />
          )}
          {!isAdmin && <span className="sc-filter-self">本人课表 · {teachers.find((t) => t.id === myTeacherId)?.name || '我'}</span>}
          <Select allowClear placeholder="按教室筛选" style={{ width: 130 }} options={roomOptions}
            value={filter.classroomId} onChange={(v) => setFilter({ ...filter, classroomId: v })} />
          <Select allowClear showSearch optionFilterProp="label" placeholder="按学生筛选" style={{ width: 140 }}
            options={memberOptions} value={filter.studentId}
            onChange={(v) => setFilter({ ...filter, studentId: v })} />
        </div>
        <div className="sc-toolbar-actions">
          <Space size={4}>
            <Tooltip title="导出 Excel"><Button icon={<DownloadOutlined />} onClick={exportExcel} /></Tooltip>
            <Tooltip title="打印课表"><Button icon={<PrinterOutlined />} onClick={() => window.print()} /></Tooltip>
            <Tooltip title="课表设置"><Button icon={<SettingOutlined />} onClick={() => setSettingsModal(true)} /></Tooltip>
          </Space>
          {/* 非当前学期：编辑入口完全不展示，课表只读 */}
          {canEdit && activeSem?.is_current === 1 && (
            <div className="sc-edit-group">
              {!editing ? (
                <Button type="primary" icon={<EditOutlined />} onClick={enterEdit} disabled={busy}>
                  编辑课表
                </Button>
              ) : (
                <>
                  <Button icon={<CloseOutlined />} onClick={cancelEdit} disabled={busy}
                    title={changes ? `放弃本次 ${changes} 处改动，回到进入编辑前的状态` : '退出编辑，不保留改动'}>
                    取消编辑
                  </Button>
                  <Button type="primary" icon={<CheckOutlined />} onClick={finishEdit} disabled={busy}
                    title="保留本次编辑的全部改动并退出编辑">
                    完成编辑
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <span className="sc-toolbar-info">
          {activeSem ? `${activeSem.name}（${activeSem.start_date} ~ ${activeSem.end_date}） · ` : ''}
          {rangeFrom} ~ {rangeTo} · {displayLessons.length} 节课{loading ? ' · 加载中…' : ''}
        </span>
      </div>

      {/* 区域 B：课表画布 */}
      <ScheduleCanvas
        days={days} lessons={displayLessons} allLessons={lessons} settings={settings} viewMode={viewMode}
        editable={editing && canEdit} selectedDate={selectedDate}
        teachers={teachers} classrooms={classrooms} conflicts={conflicts}
        studentHints={studentHints} scrollRef={scrollRef}
        pendingNew={editor?.lesson ? null : pendingNew} pendingRemoveIds={pendingRemoveIds}
        draftDefaults={draftDefaults}
        onBlank={openNew} onEdit={openEdit} onMove={handleMove} onResize={handleResize}
        onPreview={previewNew} onPreviewResize={resizePreview} onPreviewCancel={cancelPreview}
        onDelete={handleDelete} onContext={(lesson, x, y) => setCtx({ lesson, x, y })}
        onSelectDate={(d) => setSelectedDate(clampToSem(d))}
      />

      {/* 右键快捷菜单 */}
      {ctx && (
        <div className="sc-ctx" style={{ left: Math.min(ctx.x, window.innerWidth - 160), top: Math.min(ctx.y, window.innerHeight - 130) }}
          onClick={(e) => e.stopPropagation()}>
          <div className="sc-ctx-title">{ctx.lesson.title || '未命名课程'}</div>
          <button onClick={() => openEdit(ctx.lesson)}>✎ 编辑课程</button>
          <button onClick={() => handleDuplicate(ctx.lesson)}>⧉ 复制课程</button>
          <button className="danger" onClick={() => handleDelete(ctx.lesson)}>✕ 删除课程</button>
        </div>
      )}

      {/* 新建 / 编辑弹窗 */}
      {editor && (
        <LessonModal key={editorKey} open meta={editorMeta} lesson={editor.lesson} readOnly={!!editor.readOnly}
          initial={editor.initial} seriesCount={seriesCount} busy={busy}
          replaceCount={editor.lesson ? 0 : (pendingNew?.removeIds?.length || 0)}
          draftClash={editor.lesson ? null : draftClash}
          onFormChange={editor.lesson ? undefined : onDraftChange}
          onCancel={closeEditor} onSubmit={submitEditor}
          onDelete={handleDelete} onDeleteSeries={handleDeleteSeries} />
      )}

      {/* 冲突汇总明细：按「冲突域」列出（同教师/同教室 + 同时段 = 一处） */}
      <Modal open={conflictModal} title="当前视图冲突明细（按教师 / 教室 + 时段合并）" width={680} footer={null}
        onCancel={() => setConflictModal(false)}>
        {conflictRows.length === 0 && <Empty description="暂无冲突" />}
        {conflictRows.map((d) => (
          <div key={d.key} className="sc-conflict-row" style={{ display: 'block', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <b>{d.date} {weekOf(d.date)}</b>
              <span>{hhmm(d.start)}–{hhmm(d.end)}</span>
              <Tag color="red">{d.count} 节课重叠</Tag>
              <span style={{ color: '#666' }}>{d.reason}</span>
            </div>
            <div style={{ marginTop: 6, color: '#555', fontSize: 12 }}>
              {d.teacherName && <span>教师：{d.teacherName}　</span>}
              {d.roomName && <span>教室：{d.roomName}</span>}
            </div>
            <div style={{ marginTop: 4, paddingLeft: 2 }}>
              {d.lessons.map((l) => (
                <div key={l.id} style={{ fontSize: 12, color: '#666', lineHeight: '20px' }}>
                  · {hhmm(parseTime(l.start_time))}–{hhmm(parseTime(l.end_time))}
                  　{l.title || '未命名课程'}　{l.classroom_name || '未指定教室'}
                  {(l.students || []).length ? `　学生：${(l.students || []).map((s) => s.name).join('、')}` : ''}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Modal>

      {/* 课表设置：时间范围 / 布局 / 显示项 */}
      <Modal open={settingsModal} title="课表设置" width={560} okText="保存设置" cancelText="取消"
        onCancel={() => setSettingsModal(false)}
        onOk={() => { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); setSettingsModal(false); message.success('设置已保存'); }}>
        <div className="sc-settings">
          <div className="sc-settings-group">时间范围</div>
          <div className="sc-form-item"><label>每日开始时间</label>
            <Select style={{ width: 118 }} options={hourOptions.filter((h) => h.value < settings.endHour)}
              value={settings.startHour} onChange={(v) => setSettings({ ...settings, startHour: v })} /></div>
          <div className="sc-form-item"><label>每日结束时间</label>
            <Select style={{ width: 118 }} options={hourOptions.filter((h) => h.value > settings.startHour && h.value <= 23)}
              value={settings.endHour} onChange={(v) => setSettings({ ...settings, endHour: v })} /></div>

          <div className="sc-settings-group sc-span2">布局</div>
          <div className="sc-form-item sc-toggle"><label>拖拽吸附到 30 分钟网格</label>
            <Switch checked={settings.snap !== false} onChange={(v) => setSettings({ ...settings, snap: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>同一天按教师拆分独立时间线</label>
            <Switch checked={settings.splitByTeacher !== false}
              onChange={(v) => setSettings({ ...settings, splitByTeacher: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>显示右侧第二时间刻度</label>
            <Switch checked={settings.showRuler !== false}
              onChange={(v) => setSettings({ ...settings, showRuler: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>紧凑课块（隐藏学生与时间行）</label>
            <Switch checked={!!settings.dense} onChange={(v) => setSettings({ ...settings, dense: v })} /></div>

          <div className="sc-settings-group sc-span2">显示内容</div>
          <div className="sc-form-item sc-toggle"><label>课块上显示学生姓名</label>
            <Switch checked={settings.showStudents} onChange={(v) => setSettings({ ...settings, showStudents: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>高亮冲突课程</label>
            <Switch checked={settings.showConflicts !== false}
              onChange={(v) => setSettings({ ...settings, showConflicts: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>显示循环 / 状态标记</label>
            <Switch checked={settings.showBadges !== false}
              onChange={(v) => setSettings({ ...settings, showBadges: v })} /></div>
          <div className="sc-form-item sc-toggle"><label>顶部显示冲突汇总条</label>
            <Switch checked={settings.showConflictBar !== false}
              onChange={(v) => setSettings({ ...settings, showConflictBar: v })} /></div>

          <div className="sc-form-item sc-span2 sc-hint">
            时间范围默认为 7:00–21:00，可按机构作息调整；以上设置保存在本机浏览器。
          </div>
        </div>
      </Modal>

      {/* 打印页眉（仅打印时可见） */}
      <div className="sc-print-head">
        <h2>课程表</h2>
        <div>{rangeFrom} ~ {rangeTo} · {settings.startHour}:00–{settings.endHour}:00 · 共 {displayLessons.length} 节课</div>
      </div>
    </div>
  );
}
