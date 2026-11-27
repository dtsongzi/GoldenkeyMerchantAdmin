import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, Switch, DatePicker, App as AntApp, Typography, Popconfirm,
} from 'antd';
import dayjs from 'dayjs';
import { PlusOutlined, EditOutlined, DeleteOutlined, StarFilled } from '@ant-design/icons';
import { api } from '../api.js';

const { RangePicker } = DatePicker;
const TERM = { 1: '上学期', 2: '下学期' };

export default function Semesters() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setRows(await api.semesters()); }
    catch (e) { message.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ term: 1, status: 1, is_current: false });
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({
      name: r.name, term: r.term, status: r.status, is_current: !!r.is_current, remark: r.remark,
      range: r.start_date && r.end_date ? [dayjs(r.start_date), dayjs(r.end_date)] : null,
    });
    setOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      name: v.name.trim(), term: Number(v.term), status: v.status ? 1 : 0,
      is_current: !!v.is_current, remark: v.remark || '',
      start_date: v.range[0].format('YYYY-MM-DD'),
      end_date: v.range[1].format('YYYY-MM-DD'),
    };
    try {
      if (editing) await api.updateSemester(editing.id, body);
      else await api.createSemester(body);
      message.success(editing ? '学期已更新' : '学期已创建');
      setOpen(false);
      load();
    } catch (e) { message.error(e.message); }
  };
  const setCurrent = async (r) => {
    try { await api.setCurrentSemester(r.id); message.success('已设为当前学期'); load(); }
    catch (e) { message.error(e.message); }
  };
  const remove = async (r) => {
    try { await api.deleteSemester(r.id); message.success('学期已删除'); load(); }
    catch (e) { message.error(e.message); }
  };

  const columns = [
    { title: '学期名称', dataIndex: 'name', key: 'name', render: (v, r) => (
      <Space size={6}>
        <b>{v}</b>
        {r.is_current === 1 && <Tag color="green" icon={<StarFilled />}>当前</Tag>}
      </Space>
    ) },
    { title: '学期', dataIndex: 'term', key: 'term', width: 90, render: (v) => TERM[v] || '-' },
    { title: '日期范围', key: 'range', render: (_, r) => `${r.start_date} ~ ${r.end_date}` },
    { title: '课次数', dataIndex: 'lesson_count', key: 'lesson_count', width: 90, render: (v) => v ?? 0 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v) => <Tag color={v === 1 ? 'blue' : 'default'}>{v === 1 ? '启用' : '停用'}</Tag> },
    { title: '备注', dataIndex: 'remark', key: 'remark', render: (v) => v || '-' },
    { title: '操作', key: 'op', width: 190, render: (_, r) => (
      <Space size={4}>
        {r.is_current !== 1 && r.status === 1 && (
          <Button size="small" type="link" onClick={() => setCurrent(r)}>设为当前</Button>
        )}
        <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="删除该学期？" description="该学期下若有课次则无法删除" onConfirm={() => remove(r)} okText="删除" cancelText="取消">
          <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div>
      <Typography.Title level={4}>学期管理</Typography.Title>
      <Typography.Paragraph type="secondary">
        每年分上下两个学期，由管理员创建并指定日期范围。排课只能落在某个学期范围内，不能跨学期排课；学员预约页会自动展示「当前学期」标签。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>新建学期</Button>
      </Space>
      <Table rowKey="id" dataSource={rows} columns={columns} size="small" loading={loading}
        pagination={false} locale={{ emptyText: '暂无学期，请先新建' }} />

      <Modal open={open} title={editing ? '编辑学期' : '新建学期'} onCancel={() => setOpen(false)}
        onOk={submit} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="学期名称" rules={[{ required: true, message: '请填写学期名称' }]}>
            <Input placeholder="如：2026-2027学年上学期" />
          </Form.Item>
          <Form.Item name="term" label="学期" rules={[{ required: true }]}>
            <Select options={[{ value: 1, label: '上学期' }, { value: 2, label: '下学期' }]} />
          </Form.Item>
          <Form.Item name="range" label="日期范围" rules={[{ required: true, message: '请选择起止日期' }]}>
            <RangePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[{ value: 1, label: '启用' }, { value: 0, label: '停用' }]} />
          </Form.Item>
          <Form.Item name="is_current" label="设为当前学期" valuePropName="checked" extra="同一时刻只有一个当前学期，设为当前会自动取消其他学期">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
