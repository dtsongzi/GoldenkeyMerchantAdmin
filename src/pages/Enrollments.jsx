import { useCallback, useEffect, useState } from 'react';
import {
  Alert, App as AntApp, Avatar, Button, Card, Col, Descriptions, Input,
  Modal, Row, Space, Statistic, Table, Tag, Tabs, Typography,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, UserOutlined, AuditOutlined,
} from '@ant-design/icons';
import { api, currentUser } from '../api.js';

const { Title, Text } = Typography;

const STATUS_META = {
  0: { text: '待审核', color: 'gold' },
  1: { text: '已通过', color: 'green' },
  2: { text: '已拒绝', color: 'red' },
  3: { text: '已撤销', color: 'default' },
};

function StatusTag({ s }) {
  const m = STATUS_META[s] || { text: '未知', color: 'default' };
  return <Tag color={m.color}>{m.text}</Tag>;
}

const TABS = [
  { key: 'all', label: '全部' },
  { key: '0', label: '待审核' },
  { key: '1', label: '已通过' },
  { key: '2', label: '已拒绝' },
  { key: '3', label: '已撤销' },
];

export default function Enrollments({ user }) {
  const { message } = AntApp.useApp();
  const role = user?.role || currentUser()?.role || 'admin';
  const isAdmin = role === 'admin';

  const [tab, setTab] = useState('0');
  const [list, setList] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0, canceled: 0 });
  const [loading, setLoading] = useState(false);
  const [review, setReview] = useState(null); // { record, action }
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadStats = useCallback(() => {
    api.enrollmentStats().then(setStats).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params = tab === 'all' ? {} : { status: tab };
    api.enrollments(params)
      .then((rows) => setList(Array.isArray(rows) ? rows : []))
      .catch((e) => message.error(e.message || '报名列表加载失败'))
      .finally(() => setLoading(false));
  }, [tab, message]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStats(); }, [loadStats]);

  const openReview = (record, action) => { setReview({ record, action }); setNote(''); };

  const submit = async () => {
    if (!review) return;
    setSubmitting(true);
    try {
      await api.reviewEnrollment(review.record.id, review.action, note);
      message.success(review.action === 'approve' ? '已通过报名，学员现在可以预约该课程' : '已驳回报名，学员可重新提交');
      setReview(null);
      load();
      loadStats();
      window.dispatchEvent(new Event('gk:enroll-reviewed'));
    } catch (e) {
      message.error(e.message || '审核失败');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: '报名学员', key: 'member', width: 190,
      render: (_, r) => (
        <Space>
          <Avatar size={34} icon={<UserOutlined />} src={r.member_avatar || undefined} />
          <span>
            <div style={{ fontWeight: 600 }}>{r.member_name || '—'}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{r.member_phone || ''}</Text>
          </span>
        </Space>
      ),
    },
    {
      title: '报名课程', key: 'course', width: 220,
      render: (_, r) => (
        <span>
          <div style={{ fontWeight: 600 }}>{r.course_title}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.category || '课程'} · {r.duration_min}min
          </Text>
        </span>
      ),
    },
    { title: '授课教师', dataIndex: 'teacher_name', width: 110, render: (v) => v || '待定' },
    { title: '提交时间', dataIndex: 'created_text', width: 145 },
    {
      title: '学员留言', dataIndex: 'remark', width: 170,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    { title: '状态', dataIndex: 'status', width: 95, render: (s) => <StatusTag s={s} /> },
    {
      title: '审核信息', key: 'reviewInfo', width: 190,
      render: (_, r) => r.reviewed_at ? (
        <span>
          <div style={{ fontSize: 12 }}>
            {r.reviewed_by_role === 'admin' ? '管理员' : r.reviewed_by_role === 'system' ? '系统回填' : '教师'} · {r.reviewed_text}
          </div>
          {r.review_note && <Text type="secondary" style={{ fontSize: 12 }}>备注：{r.review_note}</Text>}
        </span>
      ) : <Text type="secondary" style={{ fontSize: 12 }}>尚未审核</Text>,
    },
    {
      title: '操作', key: 'action', width: 175, fixed: 'right',
      render: (_, r) => r.status === 3 ? (
        <Text type="secondary" style={{ fontSize: 12 }}>学员已撤销</Text>
      ) : (
        <Space size={4}>
          <Button
            type="primary" size="small" icon={<CheckOutlined />}
            disabled={r.status === 1}
            onClick={() => openReview(r, 'approve')}
          >通过</Button>
          <Button
            size="small" danger icon={<CloseOutlined />}
            disabled={r.status === 2}
            onClick={() => openReview(r, 'reject')}
          >拒绝</Button>
        </Space>
      ),
    },
  ];

  const statBox = (title, value, color) => (
    <Col span={6} key={title}>
      <Card size="small" styles={{ body: { padding: '14px 18px' } }}>
        <Statistic title={title} value={value} styles={{ content: { color, fontWeight: 700 } }} />
      </Card>
    </Col>
  );

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>
        <AuditOutlined style={{ marginRight: 8 }} />课程报名审核
      </Title>
      <Text type="secondary">学员报名后才能预约课程；审核通过后即可在小程序端选时间约课。</Text>

      {!isAdmin && (
        <Alert
          style={{ margin: '14px 0' }}
          type="info" showIcon
          message="教师视角：这里只显示你名下课程的报名，也只能审核这些报名。管理员可审核全部。"
        />
      )}

      <Row gutter={12} style={{ marginTop: 16, marginBottom: 16 }}>
        {statBox('累计报名', stats.total, '#a8843a')}
        {statBox('待审核', stats.pending, '#d48806')}
        {statBox('已通过', stats.approved, '#389e0d')}
        {statBox('已拒绝 / 已撤销', stats.rejected + stats.canceled, '#999')}
      </Row>

      <Card styles={{ body: { padding: 0 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={TABS}
          tabBarStyle={{ padding: '0 16px', margin: 0 }}
        />
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={list}
          scroll={{ x: 1250 }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (n) => `共 ${n} 条` }}
          locale={{ emptyText: tab === '0' ? '暂无待审核报名 🎉' : '暂无记录' }}
        />
      </Card>

      <Modal
        open={!!review}
        title={review?.action === 'approve' ? '通过报名' : '驳回报名'}
        okText={review?.action === 'approve' ? '确认通过' : '确认驳回'}
        cancelText="取消"
        okButtonProps={{ danger: review?.action === 'reject', loading: submitting }}
        onOk={submit}
        onCancel={() => setReview(null)}
        destroyOnHidden
      >
        {review && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 14 }}>
              <Descriptions.Item label="学员">{review.record.member_name}（{review.record.member_phone || '—'}）</Descriptions.Item>
              <Descriptions.Item label="课程">{review.record.course_title}</Descriptions.Item>
              <Descriptions.Item label="当前状态"><StatusTag s={review.record.status} /></Descriptions.Item>
              <Descriptions.Item label="学员留言">{review.record.remark || '—'}</Descriptions.Item>
            </Descriptions>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>审核备注（会推送给学员，选填）</div>
            <Input.TextArea
              rows={3}
              maxLength={200}
              showCount
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={review.action === 'approve' ? '例如：欢迎加入，记得按时来上课' : '例如：该班名额已满，可改报其它课程'}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
