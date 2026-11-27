import { useEffect, useRef, useState } from 'react';
import {
  Modal, Select, Input, DatePicker, TimePicker, Radio, Button, Space, Typography, Popconfirm,
} from 'antd';
import dayjs from 'dayjs';
import { LESSON_STATUS, hhmm, parseTime, toTimeStr, snapHour, weekOf } from './utils.js';

const { TextArea } = Input;

function toDayjs(v) {
  const h = Math.floor(v), m = Math.round((v - h) * 60);
  return dayjs().hour(h).minute(m).second(0).millisecond(0);
}

function initialForm(lesson, initial, meta) {
  // 管理员：编辑时用课程本身的教师，新建时优先用「拖拽落点泳道」的教师，最后才回落到表单默认值
  const t = meta.isAdmin
    ? (lesson?.teacher_id ?? initial?.teacherId ?? meta.defaultTeacherId)
    : meta.myTeacherId;
  if (lesson) {
    return {
      course_id: lesson.course_id ?? undefined,
      title: lesson.title || '',
      teacher_id: t ?? undefined,
      classroom_id: lesson.classroom_id ?? undefined,
      studentIds: (lesson.students || []).map((s) => s.id),
      slot_date: lesson.slot_date,
      start: parseTime(lesson.start_time),
      end: parseTime(lesson.end_time),
      remark: lesson.remark || '',
      lesson_status: lesson.lesson_status || 'normal',
      scope: 'single',
      semester_id: lesson.semester_id ?? undefined,
    };
  }
  const s = initial?.start ?? 9;
  return {
    course_id: meta.defaultCourseId,
    title: meta.defaultCourseTitle || '',
    teacher_id: t ?? undefined,
    classroom_id: initial?.classroomId ?? meta.defaultClassroomId,
    studentIds: [],
    slot_date: initial?.date,
    start: s,
    end: Math.min(meta.settings?.endHour ?? 21, s + (initial?.end && initial.end > s ? initial.end - s : 1)),
    remark: '',
    lesson_status: 'normal',
    scope: 'single',
    semester_id: meta.defaultSemesterId ?? initial?.semesterId ?? undefined,
  };
}

export default function LessonModal({
  open, lesson, initial, meta, seriesCount = 0, busy, replaceCount = 0, draftClash, onFormChange,
  onCancel, onSubmit, onDelete, onDeleteSeries, readOnly = false,
}) {
  const [f, setF] = useState(() => initialForm(lesson, initial, meta));
  const [err, setErr] = useState('');
  const set = (patch) => { setF((v) => ({ ...v, ...patch })); setErr(''); };

  // 把表单变化同步给画布：草稿轮廓与「待移除」置灰跟着教师 / 教室 / 日期 / 时段实时更新
  const changeRef = useRef(onFormChange);
  changeRef.current = onFormChange;
  useEffect(() => { changeRef.current?.(f); }, [f]);
  const settings = meta.settings || { startHour: 7, endHour: 21 };
  const isSeries = !!lesson?.series_id;
  const applySeries = isSeries && f.scope === 'series';

  const courseOptions = (meta.courses || []).map((c) => ({
    value: c.id, label: `${c.title}${c.duration_min ? ` · ${c.duration_min}min` : ''}`,
  }));
  const teacherOptions = (meta.teachers || []).map((t) => ({ value: t.id, label: t.name }));
  const roomOptions = (meta.classrooms || []).filter((r) => r.status !== 0).map((r) => ({ value: r.id, label: r.name }));
  const memberOptions = (meta.members || []).map((m) => ({ value: m.id, label: m.name }));
  const teacherName = (meta.teachers || []).find((t) => String(t.id) === String(f.teacher_id))?.name
    || (meta.isAdmin ? '该教师' : '本人');

  const submit = () => {
    if (!f.title?.trim()) return setErr('请填写课程名称');
    if (!f.teacher_id) return setErr('请选择上课教师');
    if (!f.slot_date) return setErr('请选择上课日期');
    if (f.end <= f.start) return setErr('结束时间需晚于开始时间');
    if (f.start < settings.startHour || f.end > settings.endHour) {
      return setErr(`上课时间需在 ${settings.startHour}:00–${settings.endHour}:00 之间`);
    }
    onSubmit({
      course_id: f.course_id ?? null,
      title: f.title.trim(),
      teacher_id: f.teacher_id,
      classroom_id: f.classroom_id ?? null,
      studentIds: f.studentIds,
      slot_date: f.slot_date,
      start_time: toTimeStr(f.start),
      end_time: toTimeStr(f.end),
      remark: f.remark || '',
      lesson_status: f.lesson_status,
      scope: f.scope,
      semester_id: f.semester_id ?? null,
    });
  };

  return (
    <Modal
      open={open}
      title={readOnly ? '课程详情' : (lesson ? (applySeries ? '修改整个循环系列' : '编辑课程') : '新建课程')}
      width={560}
      onCancel={onCancel}
      mask={{ closable: false }}
      styles={{ mask: { backgroundColor: 'rgba(30, 26, 18, .2)' } }}
      footer={
        readOnly ? (
          <div className="sc-modal-footer">
            <span />
            <Space><Button type="primary" onClick={onCancel}>关闭</Button></Space>
          </div>
        ) : (
          <div className="sc-modal-footer">
            <div>
              {lesson && (
                <Space>
                  <Button danger size="small" onClick={() => onDelete(lesson)}>删除本节</Button>
                  {isSeries && (
                    <Popconfirm title={`删除整个系列的 ${seriesCount} 节课？`} okText="删除系列" cancelText="取消"
                      onConfirm={() => onDeleteSeries(lesson.series_id)}>
                      <Button danger size="small">删除整个系列</Button>
                    </Popconfirm>
                  )}
                </Space>
              )}
            </div>
            <Space>
              <Button onClick={onCancel}>取消</Button>
              <Button type="primary" loading={busy} onClick={submit}>{lesson ? '保存修改' : '创建课程'}</Button>
            </Space>
          </div>
        )
      }
    >
      {readOnly && (
        <Typography.Paragraph type="secondary" className="sc-form-tip" style={{ marginTop: 0 }}>
          当前为只读查看模式，点击课表工具栏「编辑课表」后可修改课程。
        </Typography.Paragraph>
      )}
      {!readOnly && !lesson && (replaceCount > 0 || draftClash?.roomText) && (
        <div className="sc-draft-alerts">
          {replaceCount > 0 && (
            <div className="sc-replace-tip">
              该时段有 <b>{replaceCount}</b> 节<b>同一教师（{teacherName}）</b>的课程时间重叠，课表上已置灰预览；
              点「创建课程」会<b>先移除这 {replaceCount} 节再新建</b>，点「取消」则不做任何改动。
            </div>
          )}
          {draftClash?.roomText && (
            <div className="sc-room-clash">
              <div>
                <b>教室冲突</b>：{draftClash.roomText}（与教师无关，是这间教室被占了）。
              </div>
              <div className="sc-room-clash-act">
                {draftClash.freeRoom ? (
                  <>
                    <span>该时段空闲：<b>{draftClash.freeRoom.name}</b></span>
                    <Button size="small" type="primary" ghost
                      onClick={() => set({ classroom_id: draftClash.freeRoom.id })}>
                      改用「{draftClash.freeRoom.name}」
                    </Button>
                  </>
                ) : <span>该时段没有其他空闲教室，请调整时间或清空教室。</span>}
                {f.classroom_id != null && (
                  <Button size="small" type="link" onClick={() => set({ classroom_id: undefined })}>清空教室</Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {isSeries && !readOnly && (
        <div className="sc-scope">
          <span className="sc-scope-label">应用范围</span>
          <Radio.Group value={f.scope} onChange={(e) => set({ scope: e.target.value })}>
            <Radio value="single">仅本节（脱离循环，成为单次课）</Radio>
            <Radio value="series">整个系列（共 {seriesCount} 节）</Radio>
          </Radio.Group>
        </div>
      )}
      {isSeries && readOnly && (
        <div className="sc-scope">
          <span className="sc-scope-label">循环系列</span>共 {seriesCount} 节课
        </div>
      )}

      <div className="sc-form-grid">
        <div className="sc-form-item sc-span2">
          <label>课程名称 <em>*</em></label>
          <Space.Compact style={{ width: '100%' }}>
            <Select style={{ width: '46%' }} placeholder="选择课程模板" allowClear disabled={readOnly}
              options={courseOptions} value={f.course_id}
              onChange={(v) => {
                const c = (meta.courses || []).find((x) => x.id === v);
                set({ course_id: v, title: v ? (c?.title || f.title) : f.title });
              }} />
            <Input style={{ width: '54%' }} placeholder="课程名称（可自定义）" value={f.title} disabled={readOnly}
              onChange={(e) => set({ title: e.target.value })} />
          </Space.Compact>
        </div>

        <div className="sc-form-item">
          <label>上课教师 <em>*</em></label>
          <Select style={{ width: '100%' }} placeholder="选择教师" options={teacherOptions}
            value={f.teacher_id} disabled={readOnly || !meta.isAdmin}
            onChange={(v) => set({ teacher_id: v })} />
        </div>
        <div className="sc-form-item">
          <label>教室</label>
          <Select style={{ width: '100%' }} placeholder="选择教室" allowClear options={roomOptions}
            value={f.classroom_id} disabled={readOnly} onChange={(v) => set({ classroom_id: v })} />
        </div>

        <div className="sc-form-item sc-span2">
          <label>上课学生（可多选、可搜索）</label>
          <Select style={{ width: '100%' }} mode="multiple" allowClear showSearch
            optionFilterProp="label" maxTagCount="responsive" placeholder="搜索并选择学生"
            options={memberOptions} value={f.studentIds} disabled={readOnly}
            onChange={(v) => set({ studentIds: v })} />
        </div>

        <div className="sc-form-item">
          <label>所属学期</label>
          <Select style={{ width: '100%' }} placeholder="选择学期" options={(meta.semesters || []).map((s) => ({ value: s.id, label: s.name }))}
            value={f.semester_id} disabled={readOnly} onChange={(v) => set({ semester_id: v })} />
        </div>
        <div className="sc-form-item">
          <label>上课日期</label>
          <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" value={f.slot_date ? dayjs(f.slot_date) : null}
            disabled={readOnly || applySeries} onChange={(d) => set({ slot_date: d ? d.format('YYYY-MM-DD') : '' })} />
          {applySeries && <span className="sc-hint">统一修改时不改变各节课日期</span>}
        </div>
        <div className="sc-form-item">
          <label>时段</label>
          <Space.Compact style={{ width: '100%' }}>
            <TimePicker style={{ width: '50%' }} format="HH:mm" needConfirm={false} minuteStep={30}
              value={toDayjs(f.start)} disabled={readOnly}
              disabledTime={() => ({ disabledHours: () => [
                ...Array.from({ length: settings.startHour }, (_, i) => i),
                ...Array.from({ length: 24 - settings.endHour }, (_, i) => settings.endHour + i),
              ] })}
              onChange={(d) => d && set({ start: snapHour(parseTime(d.format('HH:mm')), settings) })} />
            <TimePicker style={{ width: '50%' }} format="HH:mm" needConfirm={false} minuteStep={30}
              value={toDayjs(f.end)} disabled={readOnly}
              disabledTime={() => ({ disabledHours: () => [
                ...Array.from({ length: settings.startHour }, (_, i) => i),
                ...Array.from({ length: 24 - settings.endHour }, (_, i) => settings.endHour + i),
              ] })}
              onChange={(d) => d && set({ end: snapHour(parseTime(d.format('HH:mm')), settings) })} />
          </Space.Compact>
        </div>

        <div className="sc-form-item">
          <label>课程状态</label>
          <Radio.Group value={f.lesson_status} disabled={readOnly} onChange={(e) => set({ lesson_status: e.target.value })}>
            {LESSON_STATUS.map((s) => <Radio.Button key={s.value} value={s.value}>{s.label}</Radio.Button>)}
          </Radio.Group>
        </div>
        <div className="sc-form-item">
          <label>备注</label>
          <Input placeholder="如：带教材、需调琴" value={f.remark} disabled={readOnly}
            onChange={(e) => set({ remark: e.target.value })} />
        </div>
      </div>

      {f.slot_date && (
        <div className="sc-form-summary">
          {f.slot_date} {weekOf(f.slot_date)} · {hhmm(f.start)}–{hhmm(f.end)}
          {applySeries ? ' · 将同步到整个系列' : ''}
        </div>
      )}
      {err && <div className="sc-form-error">{err}</div>}
      {!readOnly && (
        <Typography.Paragraph type="secondary" className="sc-form-tip">
          规则：同一位教师的时段重叠可以直接覆盖（旧课会被替换）；<b>教室</b>同一时段只能排一节课，
          教室被其他教师占用时需换教室或改时间，无法覆盖。学生允许同时段多课，仅作提示。
        </Typography.Paragraph>
      )}
    </Modal>
  );
}
