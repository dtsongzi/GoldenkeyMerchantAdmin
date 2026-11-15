import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, Select, Checkbox, Space, Tag, Typography, Modal, TimePicker, Input,
  DatePicker, Segmented, Switch, InputNumber, Empty, App as AntApp, Tooltip,
} from 'antd';
import {
  LeftOutlined, RightOutlined, EditOutlined, CheckOutlined, CloseOutlined,
  DownloadOutlined, PrinterOutlined, SettingOutlined, PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, currentUser } from '../api.js';
import {
  DEFAULT_SETTINGS, WEEK_OPTIONS, ALL_WEEK, LESSON_STATUS,
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
const toDayjs = (v) => dayjs().hour(Math.floor(v)).minute(Math.round((v - Math.floor(v)) * 60)).second(0).millisecond(0);
const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
// 多选下拉用完整「周X」标签，比单字更清晰
const WEEK_SELECT_OPTIONS = WEEK_OPTIONS.map((d) => ({ value: d.value, label: `周${d.label}` }));

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
  const [quick, setQuick] = useState({
    teacherId: undefined,
    courseId: undefined,
    roomIds: [],
    startDate: fmt(today),
    endDate: fmt(addDays(today, 14)),
    weekdays: ALL_WEEK,
    startHour: '09:00',
    endHour: '10:00',
    studentIds: [],
    remark: '',
    status: 'normal',
  });

  const [editor, setEditor] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  // 拖拽新建的草稿：弹窗期间在画布上画轮廓，并置灰「保存后会被替换」的冲突课
  const [pendingNew, setPendingNew] = useState(null);
  const [batchPreview, setBatchPreview] = useState(null);
  const [conflictModal, setConflictModal] = useState(false);
  const [roomMgr, setRoomMgr] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [ctx, setCtx] = useState(null);
  // 本次编辑会话：进入编辑时存一份快照，取消编辑可整体回滚
  const [changes, setChanges] = useState(0);

  const scrollRef = useRef(null);
  const sessionRef = useRef(null);
  const lessonsRef = useRef([]);
  lessonsRef.current = lessons;

  const daysCount = viewMode === 'day' ? 1 : 7;   // 视图固定最多一周，不再横向扩展
  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(parseLocal(windowStart), i)),
    [windowStart, daysCount]
  );
  const rangeFrom = windowStart;
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
  useEffect(() => {
    const p = isAdmin ? api.listCourses() : api.teacherCourses();
    p.then((rows) => setCourses((rows || []).filter((c) => c.status === 1))).catch(() => setCourses([]));
  }, [isAdmin]);
  useEffect(() => {
    const p = isAdmin ? api.listMembers() : api.teacherStudents();
    p.then((rows) => setMembers(rows || [])).catch(() => setMembers([]));
  }, [isAdmin]);
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [rangeFrom, rangeTo]);

  // 表单默认值
  useEffect(() => {
    if (!classrooms.length) return;
    setQuick((q) => (q.roomIds.length ? q : { ...q, roomIds: [classrooms[0].id] }));
  }, [classrooms]);
  useEffect(() => {
    if (!courses.length) return;
    setQuick((q) => (q.courseId ? q : { ...q, courseId: courses[0].id }));
  }, [courses]);
  useEffect(() => {
    if (!teachers.length) return;
    setQuick((q) => (q.teacherId ? q : { ...q, teacherId: isAdmin ? teachers[0].id : myTeacherId }));
  }, [teachers, isAdmin, myTeacherId]);

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
    sessionRef.current = { base: snapshotAll(), changes: 0 };
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
        setBusy(true);
        try {
          await api.restoreLessons({ ids: lessonsRef.current.map((l) => l.id), lessons: base });
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

  const openNew = (v) => {
    if (!editing) return;
    const draft = {
      date: v.date, start: v.start, end: v.end,
      teacher_id: v.teacherId ?? (quick.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId) || null),
      classroom_id: v.classroomId ?? (quick.roomIds[0] || classrooms[0]?.id || null),
    };
    setPendingNew({ ...draft, removeIds: conflictsFor(draftCandidate(draft)) });
    // 关键：把拖拽落点所在泳道的教师 / 教室作为弹窗初值，
    // 否则周视图会回落到顶部表单的默认教师，建出来的课跑到别人的泳道里。
    setEditor({
      lesson: null,
      initial: {
        date: v.date, start: v.start, end: v.end,
        teacherId: draft.teacher_id, classroomId: draft.classroom_id,
      },
    });
    setEditorKey((k) => k + 1);
  };
  const openEdit = (lesson) => {
    if (!editing) return;
    setPendingNew(null);
    setEditor({ lesson, initial: null });
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
      return { ...draft, removeIds: conflictsFor(draftCandidate(draft)) };
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
    teacherId: quick.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId) || null,
    classroomId: quick.roomIds[0] || classrooms[0]?.id || null,
  }), [quick.teacherId, quick.roomIds, teachers, classrooms, isAdmin, myTeacherId]);
  const editorMeta = useMemo(() => ({
    teachers, classrooms, courses, members, isAdmin, myTeacherId, settings,
    defaultTeacherId: editor?.initial?.laneValue && viewMode === 'teacher' ? Number(editor.initial.laneValue)
      : (quick.teacherId || (isAdmin ? teachers[0]?.id : myTeacherId)),
    defaultClassroomId: editor?.initial?.laneValue && viewMode === 'room' ? Number(editor.initial.laneValue)
      : (quick.roomIds[0] || classrooms[0]?.id),
    defaultCourseId: quick.courseId,
    defaultCourseTitle: courses.find((c) => c.id === quick.courseId)?.title || '',
  }), [teachers, classrooms, courses, members, isAdmin, myTeacherId, settings, editor, viewMode, quick]);

  const seriesCount = editor?.lesson?.series_id
    ? lessons.filter((l) => l.series_id === editor.lesson.series_id).length : 0;

  const submitEditor = async (form) => {
    const { scope, ...body } = form;
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
      try {
        await mutate(
          removeIds.length ? `新建课程（替换 ${removeIds.length} 节本人冲突课）` : '新建课程',
          async () => {
            if (removeIds.length) await api.deleteLessons(removeIds);
            return api.createLesson(body);
          }
        );
        closeEditor();
        message.success(removeIds.length
          ? `课程已创建，已移除 ${removeIds.length} 节本人冲突课程`
          : '课程已创建');
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

  // ---------- 批量循环排课 ----------
  const batchPayload = () => {
    const tid = isAdmin ? quick.teacherId : myTeacherId;
    return {
      teacherId: tid,
      courseId: quick.courseId,
      title: courses.find((c) => c.id === quick.courseId)?.title || '',
      classroomIds: quick.roomIds,
      startDate: quick.startDate,
      endDate: quick.endDate,
      weekdays: quick.weekdays,
      startHour: quick.startHour,
      endHour: quick.endHour,
      studentIds: quick.studentIds,
      remark: quick.remark,
      lesson_status: quick.status,
    };
  };
  const doBatch = async (payload, skipConflicts) => {
    setBatchPreview(null);
    const res = await mutate('批量循环排课',
      () => api.batchLessons({ ...payload, previewOnly: false, skipConflicts }));
    message.success(`已生成 ${res.created?.length || 0} 节课${res.skipped ? `，跳过 ${res.skipped} 节冲突课` : ''}`);
    if (res.created?.length) setSelectedDate(payload.startDate);
  };
  const applyQuick = async () => {
    if (!editing) { message.warning('请先点击右上角「编辑课表」'); return; }
    const p = batchPayload();
    if (!p.teacherId) return message.warning('请选择上课教师');
    if (!p.courseId) return message.warning('请选择课程');
    if (!p.classroomIds.length) return message.warning('请至少选择一间教室');
    if (!p.weekdays.length) return message.warning('请至少选择一个重复星期');
    if (!p.startDate || !p.endDate) return message.warning('请选择起止日期');
    if (p.startDate > p.endDate) return message.warning('结束日期不能早于开始日期');
    if (parseTime(p.endHour) <= parseTime(p.startHour)) return message.warning('时段结束时间需晚于起始时间');
    if (parseTime(p.startHour) < settings.startHour || parseTime(p.endHour) > settings.endHour) {
      return message.warning(`时段需在 ${settings.startHour}:00–${settings.endHour}:00 之间`);
    }
    setBusy(true);
    try {
      const preview = await api.batchLessons({ ...p, previewOnly: true });
      if (!preview.planned) return message.info('当前条件下没有可生成的课程');
      if (preview.conflicts?.length) { setBatchPreview({ payload: p, preview }); return; }
      await doBatch(p, false);
    } catch (e) { message.error('批量排课失败：' + e.message); }
    finally { setBusy(false); }
  };

  // ---------- 导航 / 视图 / 导出 / 打印 ----------
  const shift = (n) => {
    const d = addDays(parseLocal(windowStart), n);
    setWindowStart(fmt(viewMode === 'week' || viewMode === 'teacher' || viewMode === 'room' ? mondayOf(d) : d));
  };
  const changeView = (v) => {
    setViewMode(v);
    // 始终以当前选中日期为锚点：日视图定位到当天，其余视图定位到所在周的周一
    const anchor = parseLocal(selectedDate);
    setWindowStart(fmt(v === 'day' ? anchor : mondayOf(anchor)));
  };
  const jumpTo = (d) => {
    if (!d) return;
    const date = d.format('YYYY-MM-DD');
    setSelectedDate(date);
    setWindowStart(fmt(viewMode === 'day' ? parseLocal(date) : mondayOf(parseLocal(date))));
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

  // ---------- 空壳课对账清理 ----------
  const [orphan, setOrphan] = useState(null); // { loading, rows }
  const openOrphans = async () => {
    setOrphan({ loading: true, rows: [] });
    try {
      const rows = await api.lessonOrphans({ from: rangeFrom, to: rangeTo, teacherId: filter.teacherId });
      setOrphan({ loading: false, rows: rows || [] });
    } catch (e) {
      setOrphan(null);
      message.error('读取失败：' + e.message);
    }
  };
  const cleanupOrphans = async () => {
    const rows = orphan?.rows || [];
    if (!rows.length) return;
    setBusy(true);
    try {
      const r = await api.cleanupLessonOrphans(rows.map((x) => x.id));
      message.success(`已清理 ${r.deleted || rows.length} 条空壳课，现在与小程序可约时段一致`);
      setOrphan(null);
      load();
    } catch (e) {
      message.error('清理失败：' + e.message);
    } finally { setBusy(false); }
  };

  // ---------- 教室管理 ----------
  const reloadRooms = () => api.classrooms().then(setClassrooms).catch(() => {});
  const addRoom = async () => {
    const name = newRoomName.trim();
    if (!name) return;
    try { await api.createClassroom({ name }); setNewRoomName(''); reloadRooms(); message.success('已添加教室'); }
    catch (e) { message.error(e.message); }
  };
  const removeRoom = async (r) => {
    try { await api.deleteClassroom(r.id); reloadRooms(); message.success(`已删除「${r.name}」`); }
    catch (e) { message.error(e.message); }
  };

  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.name }));
  const roomOptions = classrooms.filter((r) => r.status !== 0).map((r) => ({ value: r.id, label: r.name }));
  const courseOptions = courses.map((c) => ({ value: c.id, label: `${c.title}${c.duration_min ? ` · ${c.duration_min}min` : ''}` }));
  const memberOptions = members.map((m) => ({ value: m.id, label: m.name }));
  const allWeek = quick.weekdays.length === 7;
  const someWeek = quick.weekdays.length > 0 && !allWeek;
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
              ? '编辑中：单击空白处新建、拖拽拉出时段、拖动课块移动、拖边缘改时长、右键更多操作'
              : '当前为只读查看模式，点击课表工具栏「编辑课表」后可调整课程'}
          </div>
        </div>
      </div>

      {/* 区域 A：批量循环排课表单 */}
      <div className="sc-quick sc-noprint">
        <div className="sc-quick-title"><b>批量循环排课</b><span>按日期范围 + 重复星期 + 固定时段生成系列课，多教室按顺序循环分配</span></div>
        <div className="sc-quick-fields">
          {isAdmin && (
            <div className="sc-qf"><label>上课教师</label>
              <Select placeholder="选择教师" options={teacherOptions} value={quick.teacherId}
                onChange={(v) => setQuick({ ...quick, teacherId: v })} />
            </div>
          )}
          {!isAdmin && (
            <div className="sc-qf"><label>上课教师</label>
              <Input disabled value={teachers.find((t) => t.id === myTeacherId)?.name || '本人'} title="教师账号只能排自己的课程" />
            </div>
          )}
          <div className="sc-qf"><label>课程</label>
            <Select placeholder="选择课程" options={courseOptions} value={quick.courseId}
              onChange={(v) => setQuick({ ...quick, courseId: v })} />
          </div>
          <div className="sc-qf wide"><label>教室（多选 · 循环分配）</label>
            <Select mode="multiple" allowClear placeholder="选择教室" options={roomOptions} value={quick.roomIds}
              onChange={(v) => setQuick({ ...quick, roomIds: v })} />
          </div>
          <div className="sc-qf"><label>开始日期</label>
            <DatePicker style={{ width: '100%' }} value={quick.startDate ? dayjs(quick.startDate) : null}
              onChange={(d) => setQuick({ ...quick, startDate: d ? d.format('YYYY-MM-DD') : '' })} />
          </div>
          <div className="sc-qf"><label>结束日期</label>
            <DatePicker style={{ width: '100%' }} value={quick.endDate ? dayjs(quick.endDate) : null}
              onChange={(d) => setQuick({ ...quick, endDate: d ? d.format('YYYY-MM-DD') : '' })} />
          </div>
          <div className="sc-qf wide"><label>每周重复星期（多选）</label>
            <Select mode="multiple" style={{ width: '100%' }} placeholder="选择重复星期"
              maxTagCount="responsive" options={WEEK_SELECT_OPTIONS} value={quick.weekdays}
              onChange={(v) => setQuick({ ...quick, weekdays: v })}
              popupRender={(menu) => (
                <>
                  <div className="sc-week-select-all" onMouseDown={(e) => e.preventDefault()}>
                    <Checkbox indeterminate={someWeek} checked={allWeek}
                      onChange={(e) => setQuick({ ...quick, weekdays: e.target.checked ? ALL_WEEK : [] })}>
                      全选（每天）
                    </Checkbox>
                    <span className="sc-week-count">{quick.weekdays.length}/7 天</span>
                  </div>
                  {menu}
                </>
              )} />
          </div>
          <div className="sc-qf"><label>时段起始</label>
            <TimePicker style={{ width: '100%' }} format="HH:mm" needConfirm={false} minuteStep={30}
              value={quick.startHour ? toDayjs(parseTime(quick.startHour)) : null}
              disabledTime={() => ({ disabledHours: () => [
                ...Array.from({ length: settings.startHour }, (_, i) => i),
                ...Array.from({ length: 24 - settings.endHour }, (_, i) => settings.endHour + i),
              ] })}
              onChange={(d) => setQuick({ ...quick, startHour: d ? d.format('HH:mm') : '09:00' })} />
          </div>
          <div className="sc-qf"><label>时段结束</label>
            <TimePicker style={{ width: '100%' }} format="HH:mm" needConfirm={false} minuteStep={30}
              value={quick.endHour ? toDayjs(parseTime(quick.endHour)) : null}
              disabledTime={() => ({ disabledHours: () => [
                ...Array.from({ length: settings.startHour }, (_, i) => i),
                ...Array.from({ length: 24 - settings.endHour }, (_, i) => settings.endHour + i),
              ] })}
              onChange={(d) => setQuick({ ...quick, endHour: d ? d.format('HH:mm') : '10:00' })} />
          </div>
          <div className="sc-qf wide"><label>上课学生（可选）</label>
            <Select mode="multiple" allowClear showSearch optionFilterProp="label" maxTagCount="responsive"
              placeholder="搜索并选择学生" options={memberOptions} value={quick.studentIds}
              onChange={(v) => setQuick({ ...quick, studentIds: v })} />
          </div>
          <div className="sc-qf"><label>备注（可选）</label>
            <Input placeholder="如：带教材" value={quick.remark}
              onChange={(e) => setQuick({ ...quick, remark: e.target.value })} />
          </div>
          <div className="sc-qf"><label>课程状态</label>
            <Select options={LESSON_STATUS.map((s) => ({ value: s.value, label: s.label }))}
              value={quick.status} onChange={(v) => setQuick({ ...quick, status: v })} />
          </div>
        </div>
        <div className="sc-quick-actions">
          <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={applyQuick}>快捷排课</Button>
          <Button onClick={() => setRoomMgr(true)}>教室管理</Button>
          <Button icon={<DownloadOutlined />} onClick={exportExcel}>导出课表</Button>
          <Button onClick={openOrphans}>清理空壳课</Button>
          <span className="sc-quick-note">生成前自动预检教师 / 教室冲突，冲突可逐条跳过</span>
        </div>
      </div>

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
            value={dayjs(selectedDate)} onChange={jumpTo} />
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
          <div className="sc-edit-group">
            {!editing ? (
              <Button type="primary" icon={<EditOutlined />} onClick={enterEdit} disabled={!canEdit || busy}>
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
        </div>
        <span className="sc-toolbar-info">
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
        onDelete={handleDelete} onContext={(lesson, x, y) => setCtx({ lesson, x, y })}
        onSelectDate={(d) => setSelectedDate(d)}
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
        <LessonModal key={editorKey} open meta={editorMeta} lesson={editor.lesson}
          initial={editor.initial} seriesCount={seriesCount} busy={busy}
          replaceCount={editor.lesson ? 0 : (pendingNew?.removeIds?.length || 0)}
          draftClash={editor.lesson ? null : draftClash}
          onFormChange={editor.lesson ? undefined : onDraftChange}
          onCancel={closeEditor} onSubmit={submitEditor}
          onDelete={handleDelete} onDeleteSeries={handleDeleteSeries} />
      )}

      {/* 空壳课清理：网站自建、无学生、无系列、小程序里也没有对应可约时段 */}
      <Modal open={!!orphan} title="清理空壳课" width={640}
        okText={`清理 ${orphan?.rows?.length || 0} 条`} cancelText="取消"
        okButtonProps={{ danger: true, disabled: !orphan?.rows?.length, loading: busy }}
        onOk={cleanupOrphans} onCancel={() => setOrphan(null)}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          下面是「网站自建、没有学生、不属于循环系列」的课，小程序「可约时段」里没有对应记录，
          这就是两边数量对不上的原因。清理只删这些占位课，不会动小程序的可约时段和学员预约。
        </Typography.Paragraph>
        {orphan?.loading ? <div style={{ padding: 12 }}>读取中…</div>
          : (orphan?.rows?.length ? (
            <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
              {orphan.rows.map((r) => (
                <div key={r.id} style={{
                  display: 'flex', gap: 10, padding: '8px 12px',
                  borderBottom: '1px solid #f5f5f5', fontSize: 13,
                }}>
                  <span style={{ width: 96, color: '#555' }}>{r.slot_date}</span>
                  <span style={{ width: 104, fontWeight: 600 }}>
                    {String(r.start_time).slice(0, 5)}–{String(r.end_time).slice(0, 5)}
                  </span>
                  <span style={{ flex: 1, color: '#666' }}>
                    {r.teacher_name || '未指定教师'} · {r.classroom_name || '未指定教室'}
                  </span>
                  <span style={{ color: '#999' }}>{r.title || '未命名'}</span>
                </div>
              ))}
            </div>
          ) : <div style={{ padding: 12, color: '#888' }}>没有需要清理的空壳课，两边已经一致。</div>)}
      </Modal>

      {/* 批量排课冲突预检 */}
      <Modal open={!!batchPreview} title="批量排课冲突预检" width={620}
        okText="生成（按规则处理冲突）" cancelText="取消本次批量排课"
        okButtonProps={{ danger: true, loading: busy }}
        onOk={() => doBatch(batchPreview.payload, true).catch(() => {})}
        onCancel={() => setBatchPreview(null)}>
        {batchPreview && (
          <>
            <p>计划生成 <b>{batchPreview.preview.planned}</b> 节课，其中 <b>{new Set(batchPreview.preview.conflicts.map((c) => c.index)).size}</b> 节与已有课程冲突：</p>
            <div className="sc-conflict-table">
              {batchPreview.preview.conflicts.slice(0, 30).map((c, i) => {
                const isSelf = String(c.withTeacherId) === String(c.candidateTeacherId);
                return (
                  <div key={i} className="sc-conflict-row">
                    <b>{c.date} {c.week}</b><span>{c.time}</span>
                    <Tag color={isSelf ? 'green' : 'orange'}>{isSelf ? '本人·可替换' : '教室被占'}</Tag>
                    <span>{c.detail}</span>
                  </div>
                );
              })}
              {batchPreview.preview.conflicts.length > 30 && <div className="sc-hint">… 另有 {batchPreview.preview.conflicts.length - 30} 条</div>}
            </div>
            <p className="sc-hint">「生成」会跳过教室被占用的节，并自动替换同一教师时段重叠的旧课；「取消」不写入任何数据。</p>
          </>
        )}
      </Modal>

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

      {/* 教室管理 */}
      <Modal open={roomMgr} title="教室 / 琴房管理" footer={null} onCancel={() => setRoomMgr(false)}>
        <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
          <Input placeholder="新教室名称，如 琴房 D" value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)} onPressEnter={addRoom} />
          <Button type="primary" onClick={addRoom}>添加</Button>
        </Space.Compact>
        {classrooms.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有教室，先添加一间" />}
        {classrooms.map((r) => (
          <div key={r.id} className="sc-room-row">
            <span>{r.name}{Number(r.capacity) > 1 ? ` · 可容纳 ${r.capacity} 人` : ''}</span>
            <Button size="small" type="text" danger onClick={() => removeRoom(r)}>删除</Button>
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
