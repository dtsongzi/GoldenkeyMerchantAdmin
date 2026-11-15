import { useEffect, useState } from 'react';
import {
  Table, Tag, Button, Modal, Form, Input, InputNumber, Select, Space, Typography, Card, App as AntApp,
  Avatar, Row, Col, Tooltip,
} from 'antd';
import { PlusOutlined, EditOutlined, KeyOutlined, StopOutlined, DeleteOutlined, SearchOutlined } from '@ant-design/icons';
import { api } from '../api.js';

// 只回填 Form 中注册过的字段，避免 setFieldsValue 传入未注册字段
const FORM_KEYS = ['name', 'gender', 'title', 'phone', 'email', 'joined_at', 'avatar', 'bio', 'remark', 'sort', 'status', 'username', 'password'];
const pickFormValues = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => FORM_KEYS.includes(k)));

const EMPTY = {
  name: '', gender: '女', title: '钢琴教师', phone: '', email: '', joined_at: '',
  avatar: '', bio: '', remark: '', sort: 0, status: 1, username: '', password: '',
};

const genderColor = { 男: 'blue', 女: 'magenta', 保密: 'default' };

export default function Teachers() {
  const { message, modal } = AntApp.useApp();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState(null); // { id, values }
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [pwdTarget, setPwdTarget] = useState(null);
  const [pwdForm] = Form.useForm();

  const load = (kw = keyword) => {
    setLoading(true);
    api.listAdminTeachers(kw ? { keyword: kw } : {})
      .then(setList)
      .catch((e) => { message.error(e.message || '教师列表加载失败'); setList([]); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  useEffect(() => {
    if (editing) form.setFieldsValue(pickFormValues(editing.values));
    else form.resetFields();
  }, [editing, form]);

  useEffect(() => {
    if (pwdTarget) pwdForm.resetFields();
  }, [pwdTarget, pwdForm]);

  const openNew = () => setEditing({ id: null, values: { ...EMPTY } });
  const openEdit = (t) => setEditing({ id: t.id, values: { ...t, joined_at: t.joined_at || '' } });

  const save = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const body = {
        ...v,
        sort: Number(v.sort || 0),
        status: Number(v.status),
      };
      if (editing.id) {
        if (!body.password) delete body.password;
        await api.updateTeacher(editing.id, body);
        message.success('已保存');
      } else {
        await api.createTeacher(body);
        message.success('已新增教师，账号可直接登录后台和小程序');
      }
      setEditing(null);
      load();
    } catch (e) {
      message.error(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetPwd = async () => {
    const v = await pwdForm.validateFields();
    try {
      await api.resetTeacherPassword(pwdTarget.id, v.password);
      message.success(`已重置 ${pwdTarget.name} 的登录密码`);
      setPwdTarget(null);
    } catch (e) {
      message.error(e.message || '重置失败');
    }
  };

  const toggleStatus = (t) => {
    const next = t.status === 1 ? 0 : 1;
    modal.confirm({
      title: next === 1 ? `启用 ${t.name}？` : `停用 ${t.name}？`,
      content: next === 1 ? '启用后该教师账号可正常登录后台与小程序。' : '停用后该教师无法登录后台和小程序，历史课程数据保留。',
      okText: next === 1 ? '启用' : '停用',
      cancelText: '取消',
      onOk: async () => {
        await api.updateTeacher(t.id, { ...t, status: next });
        message.success(next === 1 ? '已启用' : '已停用');
        load();
      },
    });
  };

  const del = (t) => {
    modal.confirm({
      title: `确认删除教师「${t.name}」？`,
      content: '会同时删除其登录账号。已有课程/课次/预约的教师不能删除，请改用「停用」。',
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.deleteTeacher(t.id);
          message.success('已删除');
          load();
        } catch (e) {
          message.error(e.message || '删除失败');
        }
      },
    });
  };

  const columns = [
    {
      title: '教师', key: 'name', width: 200,
      render: (_, t) => (
        <Space>
          <Avatar src={t.avatar || undefined} size={36} style={{ background: '#c9a24b' }}>
            {String(t.name || '?').slice(0, 1)}
          </Avatar>
          <div>
            <div style={{ fontWeight: 600 }}>{t.name}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t.title || '钢琴教师'}</Typography.Text>
          </div>
        </Space>
      ),
    },
    {
      title: '性别', dataIndex: 'gender', key: 'gender', width: 80,
      render: (v) => (v ? <Tag color={genderColor[v] || 'default'}>{v}</Tag> : '-'),
    },
    {
      title: '登录账号', dataIndex: 'username', key: 'username', width: 140,
      render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : <Typography.Text type="danger">未开通</Typography.Text>),
    },
    { title: '手机', dataIndex: 'phone', key: 'phone', width: 130, render: (v) => v || '-' },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 180, render: (v) => v || '-' },
    {
      title: '入职日期', dataIndex: 'joined_at', key: 'joined_at', width: 120,
      render: (v) => (v ? String(v).slice(0, 10) : '-'),
    },
    { title: '课程', dataIndex: 'course_count', key: 'course_count', width: 70, render: (v) => Number(v || 0) },
    { title: '课次', dataIndex: 'lesson_count', key: 'lesson_count', width: 70, render: (v) => Number(v || 0) },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v) => (v === 1 ? <Tag color="green">在职</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作', key: 'op', width: 200, fixed: 'right',
      render: (_, t) => (
        <Space size={4}>
          <Tooltip title="编辑资料 / 账号">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(t)} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Button size="small" icon={<KeyOutlined />} onClick={() => setPwdTarget(t)} />
          </Tooltip>
          <Tooltip title={t.status === 1 ? '停用' : '启用'}>
            <Button size="small" icon={<StopOutlined />} onClick={() => toggleStatus(t)} />
          </Tooltip>
          <Tooltip title="删除">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => del(t)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Typography.Title level={4} style={{ margin: 0 }}>教师管理</Typography.Title>
          <Typography.Text type="secondary">
            教师账号可同时登录本后台与小程序（角色为「教师」），停用后立即无法登录。
          </Typography.Text>
        </Col>
        <Col>
          <Space>
            <Input
              allowClear
              placeholder="搜索姓名 / 账号 / 手机"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => load()}
              style={{ width: 220 }}
            />
            <Button onClick={() => load()}>搜索</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>新增教师</Button>
          </Space>
        </Col>
      </Row>

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={list}
          columns={columns}
          pagination={false}
          scroll={{ x: 1180 }}
          locale={{ emptyText: '暂无教师，点右上角「新增教师」' }}
        />
      </Card>

      <Modal
        open={!!editing}
        title={editing?.id ? '编辑教师' : '新增教师'}
        onCancel={() => setEditing(null)}
        onOk={save}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请输入教师姓名' }]}>
                <Input placeholder="如：林晚晴" maxLength={50} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="性别" name="gender">
                <Select
                  options={[{ value: '女' }, { value: '男' }, { value: '保密' }]}
                  placeholder="选择性别"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="状态" name="status">
                <Select options={[{ value: 1, label: '在职' }, { value: 0, label: '停用' }]} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="职称 / 头衔" name="title">
                <Input placeholder="如：资深钢琴教师" maxLength={50} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="入职日期" name="joined_at">
                <Input placeholder="YYYY-MM-DD" maxLength={10} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="手机号" name="phone">
                <Input placeholder="用于联系与通知" maxLength={32} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="邮箱" name="email">
                <Input placeholder="选填" maxLength={128} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="头像地址" name="avatar">
            <Input placeholder="图片 URL（选填）" maxLength={512} />
          </Form.Item>

          <Form.Item label="个人简介" name="bio">
            <Input.TextArea rows={3} maxLength={2000} showCount placeholder="教学经历、擅长方向等" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="登录账号"
                name="username"
                rules={[
                  { required: true, message: '请输入登录账号' },
                  { pattern: /^[A-Za-z0-9_.@-]{3,50}$/, message: '只能字母/数字/_ . @ -，3-50 位' },
                ]}
              >
                <Input placeholder="字母或数字，如 lin" maxLength={50} autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                label="登录密码"
                name="password"
                rules={editing?.id ? [] : [{ required: true, message: '请设置初始密码' }, { min: 6, message: '至少 6 位' }]}
                extra={editing?.id ? '留空表示不修改' : undefined}
              >
                <Input.Password placeholder={editing?.id ? '留空不改' : '至少 6 位'} autoComplete="new-password" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="排序" name="sort" tooltip="数字越小越靠前">
                <InputNumber min={0} max={9999} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="备注" name="remark">
            <Input placeholder="内部备注，仅后台可见" maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={!!pwdTarget}
        title={`重置密码 · ${pwdTarget?.name || ''}`}
        onCancel={() => setPwdTarget(null)}
        onOk={resetPwd}
        okText="重置"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical" preserve={false}>
          <Form.Item
            label="新密码"
            name="password"
            rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password placeholder="至少 6 位" autoComplete="new-password" />
          </Form.Item>
          <Typography.Text type="secondary">改完立即生效，教师下次登录请用新密码。</Typography.Text>
        </Form>
      </Modal>
    </>
  );
}
