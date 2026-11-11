import { useState } from 'react';
import { Form, Input, Button, Card, Typography, App as AntApp } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { api } from '../api.js';

export default function Login({ onLogin }) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);

  const submit = async (values) => {
    setLoading(true);
    try {
      const data = await api.login(values.username, values.password);
      onLogin(data);
    } catch (e) {
      message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <Card className="login-card" styles={{ body: { padding: 34 } }}>
        <Typography.Title level={3} style={{ margin: 0 }}>商家登录</Typography.Title>
        <Typography.Paragraph type="secondary">GoldenKey 钢琴工作室管理后台</Typography.Paragraph>
        <Form layout="vertical" initialValues={{ username: 'admin', password: 'admin123' }} onFinish={submit} style={{ marginTop: 20 }}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>登录</Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
          管理员：admin / admin123 ｜ 教师（林晚晴）：lin / teacher123 ｜ 教师（陈牧之）：chen / teacher123
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
