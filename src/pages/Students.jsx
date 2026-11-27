import { useEffect, useState } from 'react';
import {
  Table, Typography, Card, Button, Modal, Form, InputNumber, Space, Tag, App as AntApp,
} from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { api, currentUser } from '../api.js';
import { CalendarHeat } from '../components/Heat.jsx';

export default function Students({ user }) {
  const { message } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const [list, setList] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState({});
  const [hours, setHours] = useState({});          // memberId -> 课时台账
  const [hourEdit, setHourEdit] = useState(null);  // { memberId, courseId, record }
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = () => {
    const p = isAdmin ? api.listMembers() : api.teacherStudents();
    p.then(setList).catch(() => setList([]));
  };
  useEffect(() => { load(); }, []);

  const loadDetail = (id) => {
    if (detail[id]) return;
    const fn = isAdmin ? api.studentDetail(id) : api.teacherStudentDetail(id);
    fn.then((d) => setDetail((prev) => ({ ...prev, [id]: d }))).catch(() => {});
    api.courseHours({ memberId: id })
      .then((rows) => setHours((prev) => ({ ...prev, [id]: rows || [] })))
      .catch(() => setHours((prev) => ({ ...prev, [id]: [] })));
  };
  const toggle = (exp, record) => {
    const id = exp ? record.id : null;
    setExpanded(id);
    if (id) loadDetail(id);
  };

  const openHourEdit = (memberId, r) => {
    setHourEdit({ memberId, courseId: r.course_id, record: r });
    form.setFieldsValue({ total_hours: r.total_hours, used_hours: r.used_hours });
  };
  const saveHour = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const updated = await api.updateCourseHours(hourEdit.memberId, hourEdit.courseId, {
        total_hours: Number(v.total_hours), used_hours: Number(v.used_hours),
      });
      setHours((prev) => ({
        ...prev,
        [hourEdit.memberId]: (prev[hourEdit.memberId] || []).map((x) =>
          x.course_id === hourEdit.courseId ? { ...x, ...updated } : x),
      }));
      message.success('课时已更新');
      setHourEdit(null);
    } catch (e) { message.error(e.message); }
    finally { setSaving(false); }
  };

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '手机号', dataIndex: 'phone', key: 'phone', render: (v) => v || '-' },
    { title: '预约次数', dataIndex: 'booking_count', key: 'booking_count', render: (v) => v || 0 },
    { title: '已上课时', key: 'done_hours', render: (_, m) => <b style={{ color: '#2c6b48' }}>{Number(m.done_hours ?? m.record_count ?? 0)} 节</b> },
    { title: '未上课时', key: 'upcoming_hours', render: (_, m) => <b style={{ color: '#a8843a' }}>{Number(m.upcoming_hours ?? 0)} 节</b> },
    { title: '注册时间', dataIndex: 'created_at', key: 'created_at', render: (v) => v || '-' },
  ];

  const hourCols = (memberId) => [
    { title: '课程', dataIndex: 'course_title', key: 'course_title' },
    { title: '授课教师', dataIndex: 'teacher_name', key: 'teacher_name', render: (v) => v || '-' },
    { title: '总课时', dataIndex: 'total_hours', key: 'total_hours', render: (v) => `${Number(v || 0)} h` },
    { title: '已上课时', dataIndex: 'used_hours', key: 'used_hours', render: (v) => <b style={{ color: '#2c6b48' }}>{Number(v || 0)} h</b> },
    { title: '剩余课时', dataIndex: 'remaining_hours', key: 'remaining_hours', render: (v) => <b style={{ color: '#a8843a' }}>{Number(v || 0)} h</b> },
    { title: '操作', key: 'op', render: (_, r) => (
      <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openHourEdit(memberId, r)}>修改课时</Button>
    ) },
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
    const rows = hours[record.id] || [];
    return (
      <div className="detail-box" onClick={(e) => e.stopPropagation()}>
        <div className="detail-sec">
          <Space align="center" size={8}><b>课程课时台账</b><Tag color="blue">单位：小时</Tag></Space>
          <Typography.Paragraph type="secondary" style={{ margin: '6px 0 10px' }}>
            报名通过时按课程默认课时初始化；每次上课打卡后按实际上课时长自动累加已上课时。管理员 / 教师可手动修改。
          </Typography.Paragraph>
          {rows.length
            ? <Table size="small" className="sub-table" rowKey="id" pagination={false} dataSource={rows} columns={hourCols(record.id)} />
            : <Typography.Text type="secondary">该学员暂无课时记录（报名审核通过后自动生成）</Typography.Text>}
        </div>
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

      <Modal open={!!hourEdit} title="修改学生课时" onCancel={() => setHourEdit(null)}
        onOk={saveHour} okText="保存" cancelText="取消" confirmLoading={saving} destroyOnClose>
        {hourEdit && (
          <>
            <Typography.Paragraph type="secondary">
              学员：{hourEdit.record.member_name || ''} ｜ 课程：{hourEdit.record.course_title || ''}
            </Typography.Paragraph>
            <Form form={form} layout="vertical" preserve={false}>
              <Form.Item name="total_hours" label="总课时（小时）" rules={[{ required: true, message: '请输入总课时' }]}>
                <InputNumber min={0} step={0.5} precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="used_hours" label="已上课时（小时）" rules={[{ required: true, message: '请输入已上课时' }]} extra="剩余课时 = 总课时 - 已上课时">
                <InputNumber min={0} step={0.5} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </>
  );
}
