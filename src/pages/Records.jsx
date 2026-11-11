import { useEffect, useState } from 'react';
import { Select, Button, Table, Tag, Space, Typography, Card } from 'antd';
import { api, currentUser } from '../api.js';

export default function Records({ user }) {
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const [list, setList] = useState([]);
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [f, setF] = useState({ courseId: '', teacherId: '', memberId: '' });

  useEffect(() => {
    api.teachers().then(setTeachers).catch(() => {});
    (isAdmin ? api.listCourses() : api.teacherCourses()).then(setCourses).catch(() => {});
    (isAdmin ? api.listMembers() : api.teacherStudents()).then(setStudents).catch(() => {});
  }, []);

  const load = () => {
    const q = {};
    if (f.courseId) q.courseId = f.courseId;
    if (f.memberId) q.memberId = f.memberId;
    if (isAdmin && f.teacherId) q.teacherId = f.teacherId;
    const p = isAdmin ? api.listRecords(q) : api.teacherRecords(q);
    p.then(setList).catch(() => setList([]));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); };

  const columns = [
    { title: '日期', dataIndex: 'class_date', key: 'class_date' },
    { title: '时间', key: 'time', render: (_, r) => `${r.start_time} - ${r.end_time}` },
    { title: '学员', dataIndex: 'member_name', key: 'member_name', render: (v) => v || '-' },
    { title: '课程', dataIndex: 'course_title', key: 'course_title', render: (v) => v || '-' },
    { title: '教师', dataIndex: 'teacher_name', key: 'teacher_name', render: (v) => v || '-' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s) => s === 1 ? <Tag color="green">已上课</Tag> : <Tag color="red">缺勤</Tag> },
  ];

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>上课记录</Typography.Title>
      <Typography.Paragraph type="secondary">
        {isAdmin ? '全部到课 / 缺勤记录，可按课程、教师、学生筛选' : '本人授课记录，可按课程、学生筛选'}
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 14 }}>
        <Space wrap>
          <Select style={{ width: 170 }} placeholder="全部课程" allowClear value={f.courseId || undefined}
            onChange={(v) => set('courseId', v || '')} options={courses.map((c) => ({ value: c.id, label: c.title }))} />
          {isAdmin && (
            <Select style={{ width: 170 }} placeholder="全部教师" allowClear value={f.teacherId || undefined}
              onChange={(v) => set('teacherId', v || '')} options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
          )}
          <Select style={{ width: 170 }} placeholder="全部学生" allowClear value={f.memberId || undefined}
            onChange={(v) => set('memberId', v || '')} options={students.map((m) => ({ value: m.id, label: m.name }))} />
          <Button type="primary" onClick={load}>查询</Button>
          <Button onClick={() => { setF({ courseId: '', teacherId: '', memberId: '' }); setTimeout(() => { const p = isAdmin ? api.listRecords({}) : api.teacherRecords({}); p.then(setList).catch(() => setList([])); }, 0); }}>重置</Button>
        </Space>
      </Card>

      <Table rowKey="id" dataSource={list} columns={columns} pagination={{ pageSize: 12, showSizeChanger: false }} locale={{ emptyText: '暂无记录' }} />
    </>
  );
}
