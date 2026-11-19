import { useEffect, useState } from 'react';
import {
  Tabs, Table, Tag, Button, Space, Typography, Card, DatePicker, Select, Statistic, Row, Col, App as AntApp,
} from 'antd';
import dayjs from 'dayjs';
import { api, currentUser } from '../api.js';

const todayStr = () => dayjs().format('YYYY-MM-DD');

function LessonStatus({ s }) {
  if (s === 'normal') return <Tag color="green">正常</Tag>;
  if (s === 'leave') return <Tag color="orange">请假</Tag>;
  if (s === 'suspended') return <Tag>停课</Tag>;
  return <Tag>{s}</Tag>;
}

/** 打卡模块：展示教师课程（只读），仅当天课程显示打卡按钮 */
function CheckinPanel({ user, isAdmin, teachers }) {
  const { message, modal } = AntApp.useApp();
  const [range, setRange] = useState([dayjs().startOf('month'), dayjs().endOf('month')]);
  const [teacherId, setTeacherId] = useState(isAdmin ? undefined : (user?.teacherId || undefined));
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    const q = {
      from: range && range[0] ? range[0].format('YYYY-MM-DD') : todayStr(),
      to: range && range[1] ? range[1].format('YYYY-MM-DD') : todayStr(),
    };
    if (teacherId) q.teacherId = teacherId;
    setLoading(true);
    api.checkinLessons(q).then(setList).catch((e) => { message.error(e.message || '加载失败'); setList([]); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [teacherId]);

  const doCheckin = (row) => {
    modal.confirm({
      title: `确认打卡：${row.title || '课程'}？`,
      content: `${row.slot_date} ${String(row.start_time).slice(0, 5)}–${String(row.end_time).slice(0, 5)} · ${row.teacher_name || ''}`,
      okText: '确认打卡', cancelText: '取消',
      onOk: async () => {
        try {
          const r = await api.doCheckin(row.id);
          message.success(r && r.already ? '该课程已打过卡' : '打卡成功');
          load();
        } catch (e) { message.error(e.message || '打卡失败'); }
      },
    });
  };

  const undo = (row) => {
    modal.confirm({
      title: '撤销这次打卡？', okText: '撤销', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await api.undoCheckin(row.id); message.success('已撤销'); load(); }
        catch (e) { message.error(e.message || '撤销失败'); }
      },
    });
  };

  const columns = [
    { title: '日期', dataIndex: 'slot_date', key: 'slot_date', width: 110 },
    {
      title: '时间', key: 'time', width: 140,
      render: (_, r) => `${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}`,
    },
    { title: '课程', dataIndex: 'title', key: 'title', render: (v) => v || '-' },
    { title: '教师', dataIndex: 'teacher_name', key: 'teacher_name', render: (v) => v || '-' },
    { title: '琴房', dataIndex: 'classroom_name', key: 'classroom_name', render: (v) => v || '-' },
    {
      title: '学员', key: 'students', width: 160,
      render: (_, r) => (r.students && r.students.length ? r.students.map((s) => s.name).join('、') : '-'),
    },
    { title: '状态', dataIndex: 'lesson_status', key: 'lesson_status', width: 80, render: (v) => <LessonStatus s={v} /> },
    {
      title: '打卡', key: 'checkin', width: 150, fixed: 'right',
      render: (_, r) => {
        if (r.checked) {
          return <Space size={4}><Tag color="blue">已打卡</Tag><Button size="small" type="link" onClick={() => undo(r)}>撤销</Button></Space>;
        }
        if (r.canCheckin) return <Button size="small" type="primary" onClick={() => doCheckin(r)}>打卡</Button>;
        return <Typography.Text type="secondary" style={{ fontSize: 12 }}>—</Typography.Text>;
      },
    },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary">
        展示教师已安排的课程（只读）；仅「当天」且状态正常的课程显示打卡按钮。
      </Typography.Paragraph>
      <Card size="small" style={{ marginBottom: 14 }}>
        <Space wrap>
          <DatePicker.RangePicker value={range} onChange={setRange} allowClear={false} />
          {isAdmin && (
            <Select style={{ width: 160 }} placeholder="全部教师" allowClear value={teacherId}
              onChange={setTeacherId} options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
          )}
          <Button type="primary" onClick={load}>查询</Button>
        </Space>
      </Card>
      <Table rowKey="id" dataSource={list} columns={columns} loading={loading} size="small"
        pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 1000 }}
        locale={{ emptyText: '所选区间暂无课程' }} />
    </>
  );
}

/** 统计模块：月视图（每天打卡/课次）+ 天视图明细 + 汇总数字 */
function StatsPanel({ isAdmin, teachers }) {
  const [month, setMonth] = useState(dayjs());
  const [teacherId, setTeacherId] = useState(undefined);
  const [data, setData] = useState({ summary: { total: 0, checked: 0, unchecked: 0, rate: 0 }, days: [], details: [] });
  const [activeDate, setActiveDate] = useState('');

  const load = () => {
    const q = { month: month.format('YYYY-MM') };
    if (teacherId) q.teacherId = teacherId;
    if (activeDate) q.date = activeDate;
    api.checkinStats(q).then(setData).catch(() => {});
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month, teacherId, activeDate]);

  const dayMap = {};
  (data.days || []).forEach((d) => { dayMap[d.date] = d; });
  const first = month.startOf('month');
  const daysInMonth = month.daysInMonth();
  const lead = first.day(); // 0=周日
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(first.date(d).format('YYYY-MM-DD'));

  const columns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
    { title: '时间', key: 'time', width: 120, render: (_, r) => `${String(r.start_time).slice(0, 5)}–${String(r.end_time).slice(0, 5)}` },
    { title: '课程', dataIndex: 'title', key: 'title' },
    { title: '教师', dataIndex: 'teacher_name', key: 'teacher_name' },
    {
      title: '打卡状态', dataIndex: 'checked', key: 'checked', width: 100,
      render: (v) => (v ? <Tag color="blue">已打卡</Tag> : <Tag>未打卡</Tag>),
    },
    { title: '打卡时间', dataIndex: 'checked_at', key: 'checked_at', render: (v) => v || '-' },
    { title: '备注', dataIndex: 'note', key: 'note', render: (v) => v || '-' },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary">按月查看每位教师的课程与打卡汇总；点击日历中某天可查看当天全部课程（含未打卡）。</Typography.Paragraph>
      <Card size="small" style={{ marginBottom: 14 }}>
        <Space wrap>
          <DatePicker picker="month" value={month} onChange={(v) => { if (v) { setMonth(v); setActiveDate(''); } }} allowClear={false} />
          {isAdmin && (
            <Select style={{ width: 160 }} placeholder="全部教师" allowClear value={teacherId}
              onChange={setTeacherId} options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
          )}
        </Space>
      </Card>

      <Row gutter={16} style={{ marginBottom: 14 }}>
        <Col span={6}><Card size="small"><Statistic title="本月课次" value={data.summary.total} suffix="节" /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="已打卡" value={data.summary.checked} suffix="节" valueStyle={{ color: '#3f8600' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="未打卡" value={data.summary.unchecked} suffix="节" valueStyle={{ color: '#cf1322' }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title="打卡率" value={data.summary.rate} suffix="%" /></Card></Col>
      </Row>

      <Card size="small" title="月视图" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: 12, color: '#999', padding: '4px 0' }}>{w}</div>
          ))}
          {cells.map((key, i) => {
            if (!key) return <div key={'e' + i} />;
            const d = dayMap[key];
            const num = Number(key.slice(-2));
            const isToday = key === todayStr();
            return (
              <div key={key} onClick={() => setActiveDate(activeDate === key ? '' : key)}
                style={{
                  border: activeDate === key ? '2px solid #bfd84f' : '1px solid #eee',
                  borderRadius: 8, padding: 8, minHeight: 62, cursor: 'pointer',
                  background: isToday ? '#f8fbe9' : '#fff',
                }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{num}</div>
                {d ? (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    课 {d.total} · 打 {d.checked}
                    <div style={{ marginTop: 2, color: d.checked === d.total ? '#3f8600' : '#cf1322' }}>
                      {d.total ? `${Math.round(d.checked * 100 / d.total)}%` : '—'}
                    </div>
                  </div>
                ) : <div style={{ fontSize: 11, color: '#ccc', marginTop: 4 }}>无课</div>}
              </div>
            );
          })}
        </div>
      </Card>

      <Card size="small" title={`课程明细（含打卡状态）${activeDate ? ' · ' + activeDate : ' · 本月'}`}>
        <Table rowKey="lessonId" dataSource={data.details || []} columns={columns} size="small"
          pagination={{ pageSize: 12, showSizeChanger: false }} locale={{ emptyText: '所选区间暂无课程' }} />
      </Card>
    </>
  );
}

export default function Checkins({ user }) {
  const { message } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const [teachers, setTeachers] = useState([]);
  useEffect(() => { api.teachers().then(setTeachers).catch(() => {}); }, []);

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>课程打卡</Typography.Title>
      <Tabs items={[
        { key: 'checkin', label: '课程打卡', children: <CheckinPanel user={user} isAdmin={isAdmin} teachers={teachers} /> },
        { key: 'stats', label: '打卡统计', children: <StatsPanel isAdmin={isAdmin} teachers={teachers} /> },
      ]} />
    </>
  );
}
