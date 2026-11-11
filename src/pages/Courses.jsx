import { useEffect, useState } from 'react';
import { Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Space, Typography, Card, App as AntApp } from 'antd';
import { api, currentUser } from '../api.js';
import { CalendarHeat } from '../components/Heat.jsx';

const emptyAdmin = { title: '', category: '钢琴课', description: '', duration_min: 60, teacher_id: undefined, status: 1, sort: 0 };
const emptyApply = { title: '', category: '钢琴课', description: '', duration_min: 60 };
// 只回填 Form 中实际注册的字段，避免 setFieldsValue 传入未注册字段
const FORM_KEYS = ['title', 'category', 'teacher_id', 'duration_min', 'description', 'status'];
const pickFormValues = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => FORM_KEYS.includes(k)));

function StatusTag({ s }) {
  if (s === 1) return <Tag color="green">上架</Tag>;
  if (s === 0) return <Tag>下架</Tag>;
  if (s === 2) return <Tag color="gold">待审核</Tag>;
  return <Tag>{s}</Tag>;
}

export default function Courses({ user }) {
  const { message, modal } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';
  const [list, setList] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [detail, setDetail] = useState({});
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const load = () => {
    const p = isAdmin ? api.listCourses() : api.teacherCourses();
    p.then(setList).catch(() => setList([]));
  };
  useEffect(() => { load(); api.teachers().then(setTeachers).catch(() => {}); }, []);

  // Form 挂载后再填值，避免在 Modal 未渲染时调用 form 实例触发 antd 警告
  useEffect(() => {
    if (editing?.values) form.setFieldsValue(pickFormValues(editing.values));
    else form.resetFields();
  }, [editing, form]);

  const toggle = async (expanded, record) => {
    const id = expanded ? record.id : null;
    setExpanded(id);
    if (id && !detail[id]) {
      const fn = isAdmin ? api.courseDetail(id) : api.teacherCourseDetail(id);
      fn.then((d) => setDetail((prev) => ({ ...prev, [id]: d }))).catch(() => {});
    }
  };

  const openNew = () => setEditing({ id: null, values: isAdmin ? { ...emptyAdmin } : { ...emptyApply } });
  const openEdit = (c) => setEditing({ id: c.id, values: { ...c, teacher_id: c.teacher_id || undefined } });

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const body = isAdmin
        ? { ...values, teacher_id: values.teacher_id || null, duration_min: Number(values.duration_min), status: Number(values.status), sort: Number(values.sort || 0) }
        : { title: values.title, category: values.category, description: values.description, duration_min: Number(values.duration_min) };
      if (isAdmin) {
        if (editing.id) await api.updateCourse(editing.id, body);
        else await api.createCourse(body);
      } else {
        await api.applyCourse(body);
      }
      message.success('已保存');
      setEditing(null); load();
    } catch (e) { message.error(e.message); }
    finally { setSaving(false); }
  };

  const del = (id) => {
    modal.confirm({
      title: '确认删除该课程？', okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { await api.deleteCourse(id); message.success('已删除'); load(); },
    });
  };
  const review = async (id, action) => {
    await api.reviewCourse(id, action);
    message.success(action === 'approve' ? '已通过' : '已拒绝');
    load();
  };

  const columns = [
    { title: '课程', dataIndex: 'title', key: 'title' },
    { title: '分类', dataIndex: 'category', key: 'category' },
    { title: '教师', dataIndex: 'teacher_name', key: 'teacher_name', render: (v) => v || '-' },
    { title: '时长', dataIndex: 'duration_min', key: 'duration_min', render: (v) => `${v} 分钟` },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s) => <StatusTag s={s} /> },
    ...(isAdmin ? [{
      title: '操作', key: 'action', render: (_, c) => (
        <Space size={4} wrap onClick={(e) => e.stopPropagation()}>
          <Button size="small" onClick={() => openEdit(c)}>编辑</Button>
          <Button size="small" danger onClick={() => del(c.id)}>删除</Button>
          {c.status === 2 && <>
            <Button size="small" type="primary" onClick={() => review(c.id, 'approve')}>通过</Button>
            <Button size="small" onClick={() => review(c.id, 'reject')}>拒绝</Button>
          </>}
        </Space>
      ),
    }] : []),
  ];

  const expandedRowRender = (record) => {
    const d = detail[record.id];
    if (!d) return <Typography.Text type="secondary">加载中…</Typography.Text>;
    const studentCols = [
      { title: '学员', dataIndex: 'name' },
      { title: '手机号', dataIndex: 'phone', render: (v) => v || '-' },
      { title: '预约次数', dataIndex: 'bookings' },
      { title: '已完成课时', dataIndex: 'completed_hours', render: (v) => `${Number(v || 0).toFixed(1)} h` },
    ];
    return (
      <div className="detail-box">
        <div className="detail-sec">
          <b>课程简介</b>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{d.course?.description || '（暂无简介）'}</Typography.Paragraph>
        </div>
        <div className="detail-sec">
          <b>在读学员（{d.students?.length || 0}）</b>
          {d.students?.length
            ? <Table size="small" className="sub-table" rowKey="id" pagination={false} dataSource={d.students} columns={studentCols} />
            : <Typography.Text type="secondary">暂无学员</Typography.Text>}
        </div>
        <div className="detail-sec" style={{ gridColumn: '1 / -1' }}>
          <b>课时分布（日历）</b>
          <CalendarHeat distribution={d.distribution || []} />
        </div>
      </div>
    );
  };

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>课程管理</Typography.Title>
      <Typography.Paragraph type="secondary">
        {isAdmin ? '维护工作室课程，可编辑 / 删除 / 审核教师申请' : '仅查看本人课程，可提交新课申请待管理员审核'}
      </Typography.Paragraph>
      <Space style={{ marginBottom: 14 }}>
        <Button type="primary" onClick={openNew}>{isAdmin ? '+ 新增课程' : '+ 申请新增课程'}</Button>
      </Space>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          dataSource={list}
          columns={columns}
          onRow={(record) => ({ onClick: () => toggle(expanded === record.id ? false : true, record), style: { cursor: 'pointer' } })}
          expandable={{
            expandRowByClick: true,
            expandedRowKeys: expanded ? [expanded] : [],
            onExpand: toggle,
            expandedRowRender,
          }}
          pagination={false}
          locale={{ emptyText: '暂无课程' }}
        />
      </Card>

      <Modal
        open={!!editing}
        title={isAdmin ? (editing?.id ? '编辑课程' : '新增课程') : '申请新增课程'}
        okText="保存" cancelText="取消" confirmLoading={saving}
        onOk={save} onCancel={() => setEditing(null)} forceRender
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label="课程名称" name="title" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="分类" name="category" rules={[{ required: true, message: '请输入分类' }]}>
            <Input />
          </Form.Item>
          {isAdmin && (
            <Form.Item label="授课教师" name="teacher_id">
              <Select allowClear placeholder="未指定" options={teachers.map((t) => ({ value: t.id, label: t.name }))} />
            </Form.Item>
          )}
          <Form.Item label="时长（分钟）" name="duration_min" rules={[{ required: true, message: '请输入时长' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={3} />
          </Form.Item>
          {isAdmin && (
            <Form.Item label="状态" name="status">
              <Select options={[{ value: 1, label: '上架' }, { value: 0, label: '下架' }, { value: 2, label: '待审核' }]} />
            </Form.Item>
          )}
          {!isAdmin && <Typography.Paragraph type="secondary" style={{ margin: 0 }}>提交后将进入「待审核」，由管理员通过后上架。</Typography.Paragraph>}
        </Form>
      </Modal>
    </>
  );
}
