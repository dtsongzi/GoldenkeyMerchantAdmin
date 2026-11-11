import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Layout, Menu, Button, Typography, Badge } from 'antd';
import { LogoutOutlined, DashboardOutlined, BookOutlined, TeamOutlined, CalendarOutlined, FileTextOutlined, AuditOutlined } from '@ant-design/icons';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Courses from './pages/Courses.jsx';
import Students from './pages/Students.jsx';
import Schedule from './pages/Schedule.jsx';
import Records from './pages/Records.jsx';
import Enrollments from './pages/Enrollments.jsx';
import { api, currentUser } from './api.js';

const { Sider, Content } = Layout;

function Shell({ user, onLogout, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const refresh = () => api.enrollmentStats().then((s) => setPending(s.pending || 0)).catch(() => {});
    refresh();
    // 审核页提交后立即刷新待审数，无需切换页面
    window.addEventListener('gk:enroll-reviewed', refresh);
    return () => window.removeEventListener('gk:enroll-reviewed', refresh);
  }, [location.pathname]);
  const items = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '数据概览' },
    { key: '/enrollments', icon: <AuditOutlined />, label: <span>报名审核 {pending > 0 && <Badge count={pending} size="small" offset={[4, -2]} />}</span> },
    { key: '/courses', icon: <BookOutlined />, label: '课程管理' },
    { key: '/students', icon: <TeamOutlined />, label: '学生管理' },
    { key: '/schedule', icon: <CalendarOutlined />, label: '排课管理' },
    { key: '/records', icon: <FileTextOutlined />, label: '上课记录' },
  ];
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} style={{ background: '#1f1b16' }}>
        <div style={{ padding: '22px 18px 6px', color: '#e9c97a', fontWeight: 700, fontSize: 18 }}>
          GoldenKey
          <Typography.Text style={{ display: 'block', fontSize: 11, color: '#8a8276', fontWeight: 400, marginTop: 4 }}>
            钢琴工作室 · 商家后台
          </Typography.Text>
        </div>
        <div style={{ margin: '0 14px 14px', padding: '8px 10px', background: '#2a241d', borderRadius: 8, fontSize: 12, color: '#e9c97a' }}>
          {user?.role === 'admin' ? '管理员' : '教师'} · {user?.username || ''}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
          style={{ background: 'transparent', borderRight: 0 }}
        />
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={onLogout}
          style={{ position: 'absolute', bottom: 18, left: 16, right: 16, color: '#b9b0a0', textAlign: 'left' }}
        >
          退出登录
        </Button>
      </Sider>
      <Layout>
        <Content style={{ padding: 26 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('gk_token'));
  const [user, setUser] = useState(currentUser());
  const logout = () => {
    localStorage.removeItem('gk_token');
    localStorage.removeItem('gk_user');
    window.location.reload();
  };

  if (!token) {
    return (
      <Login
        onLogin={(data) => {
          localStorage.setItem('gk_token', data.token);
          localStorage.setItem('gk_user', JSON.stringify({ role: data.role, username: data.username, teacherId: data.teacherId }));
          setUser({ role: data.role, username: data.username, teacherId: data.teacherId });
          setToken(data.token);
        }}
      />
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Shell user={user} onLogout={logout}><Dashboard user={user} /></Shell>} />
      <Route path="/enrollments" element={<Shell user={user} onLogout={logout}><Enrollments user={user} /></Shell>} />
      <Route path="/courses" element={<Shell user={user} onLogout={logout}><Courses user={user} /></Shell>} />
      <Route path="/students" element={<Shell user={user} onLogout={logout}><Students user={user} /></Shell>} />
      <Route path="/schedule" element={<Shell user={user} onLogout={logout}><Schedule user={user} /></Shell>} />
      <Route path="/records" element={<Shell user={user} onLogout={logout}><Records user={user} /></Shell>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
