import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Switch, App as AntApp, Typography, Popconfirm,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api } from '../api.js';

export default function Classrooms() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try { setRows(await api.classrooms()); }
    catch (e) { message.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ capacity: 1, status: 1, sort: 0 });
    setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    form.setFieldsValue({ name: r.name, capacity: r.capacity, status: r.status === 1, sort: r.sort });
    setOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    const body = {
      name: v.name.trim(), capacity: Number(v.capacity) || 1,
      status: v.status ? 1 : 0, sort: Number(v.sort) || 0,
    };
    try {
      if (editing) await api.updateClassroom(editing.id, body);
      else await api.createClassroom(body);
      message.success(editing ? '教室已更新' : '教室已添加');
      setOpen(false);
      load();
    } catch (e) { message.error(e.message); }
  };
  const remove = async (r) => {
    try { await api.deleteClassroom(r.id); message.success(`已删除「${r.name}」`); load(); }
    catch (e) { message.error(e.message); }
  };

  const columns = [
    { title: '教室 / 琴房', dataIndex: 'name', key: 'name', render: (v) => <b>{v}</b> },
    { title: '容纳人数', dataIndex: 'capacity', key: 'capacity', width: 110, render: (v) => v ?? 1 },
    { title: '排序', dataIndex: 'sort', key: 'sort', width: 90, render: (v) => v ?? 0 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v) => <Tag color={v === 1 ? 'blue' : 'default'}>{v === 1 ? '启用' : '停用'}</Tag> },
    { title: '操作', key: 'op', width: 150, render: (_, r) => (
      <Space size={4}>
        <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title={`删除「${r.name}」？`} description="已有课程上的教室名称会保留，但不再可选" onConfirm={() => remove(r)} okText="删除" cancelText="取消">
          <Button size="small" type="link" danger icon={<DeleteOutlined />}>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div>
      <Typography.Title level={4}>教室管理</Typography.Title>
      <Typography.Paragraph type="secondary">
        维护琴房 / 教室档案，供排课与小程序预约选择。停用后不再出现在可选列表里，历史课程不受影响。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>新建教室</Button>
      </Space>
      <Table rowKey="id" dataSource={rows} columns={columns} size="small" loading={loading}
        pagination={false} locale={{ emptyText: '暂无教室，请先新建' }} />

      <Modal open={open} title={editing ? '编辑教室' : '新建教室'} onCancel={() => setOpen(false)}
        onOk={submit} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="教室名称" rules={[{ required: true, message: '请填写教室名称' }]}>
            <Input placeholder="如：琴房 A" />
          </Form.Item>
          <Form.Item name="capacity" label="容纳人数">
            <InputNumber min={1} max={99} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort" label="排序（越小越靠前）">
            <InputNumber min={0} max={999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
