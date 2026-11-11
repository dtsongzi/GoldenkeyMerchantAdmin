import { useEffect, useState } from 'react';
import { Table, Typography, Card } from 'antd';
import { api, currentUser } from '../api.js';
import { CalendarHeat } from '../components/Heat.jsx';

export default function Students({ user }) {
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const [list, setList] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState({});

  const load = () => {
    const p = isAdmin ? api.listMembers() : api.teacherStudents();
    p.then(setList).catch(() => setList([]));
  };
  useEffect(() => { load(); }, []);

  const toggle = (exp, record) => {
    const id = exp ? record.id : null;
    setExpanded(id);
    if (id && !detail[id]) {
      const fn = isAdmin ? api.studentDetail(id) : api.teacherStudentDetail(id);
      fn.then((d) => setDetail((prev) => ({ ...prev, [id]: d }))).catch(() => {});
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '手机号', dataIndex: 'phone', key: 'phone', render: (v) => v || '-' },
    { title: '预约次数', dataIndex: 'booking_count', key: 'booking_count', render: (v) => v || 0 },
    { title: '已完成课时', key: 'hours', render: (_, m) => `${(Number(m.completed_hours || (m.agg && m.agg.completed_hours) || 0)).toFixed(1)} h` },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v) => v || '-' },
  ];

  const expandedRowRender = (record) => {
    const d = detail[record.id];
    if (!d) return <Typography.Text type="secondary">加载中…</Typography.Text>;
    const courseCols = [
      { title: '课程', dataIndex: 'title' },
      { title: '预约次数', dataIndex: 'bookings' },
      { title: '已完成', dataIndex: 'completed' },
      { title: '已完成课时', dataIndex: 'completed_hours', render: (v) => `${Number(v || 0).toFixed(1)} h` },
    ];
    return (
      <div className="detail-box">
        <div className="detail-sec">
          <b>课程列表</b>
          {d.courses?.length
            ? <Table size="small" className="sub-table" rowKey="id" pagination={false} dataSource={d.courses} columns={courseCols} />
            : <Typography.Text type="secondary">暂无课程</Typography.Text>}
        </div>
        {isAdmin && (
          <div className="detail-sec">
            <b>出勤统计</b>
            <p>
              预约 <b>{d.agg?.booking_count || 0}</b> 次 ｜ 上课 <b>{d.agg?.record_count || 0}</b> 次 ｜
              缺勤 <b className="text-danger">{d.agg?.absent || 0}</b> 次
            </p>
          </div>
        )}
        <div className="detail-sec">
          <b>课时分布（日历）</b>
          <CalendarHeat distribution={d.distribution || []} />
        </div>
      </div>
    );
  };

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>学生管理</Typography.Title>
      <Typography.Paragraph type="secondary">{isAdmin ? '全部会员与上课情况' : '仅显示本人授课的学员'}</Typography.Paragraph>
      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={list}
          columns={columns}
          expandable={{ expandRowByClick: true, expandedRowKeys: expanded ? [expanded] : [], onExpand: toggle, expandedRowRender }}
          pagination={false}
          locale={{ emptyText: '暂无学生' }}
        />
      </Card>
    </>
  );
}
