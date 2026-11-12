import * as echarts from 'echarts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Statistic, Typography, Empty } from 'antd';
import { api, currentUser } from '../api.js';

// ---------- ECharts 封装：负责初始化 / 更新 / 自适应 / 销毁 ----------
function EChart({ option, height = 240 }) {
  const elRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, true);
  }, [option]);

  return <div ref={elRef} style={{ width: '100%', height }} />;
}

const C = { gold: '#c9a24b', green: '#3a9d6b', orange: '#d98a3a', red: '#c0504d', axis: '#8a8276', text: '#5a544a' };

function buildOptions(charts) {
  const dates = (arr) => (arr || []).map((d) => d.date.slice(5));
  const bookingOption = {
    grid: { left: 32, right: 12, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: dates(charts.bookingTrend), axisLabel: { fontSize: 10, color: C.axis }, axisLine: { lineStyle: { color: C.axis } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10, color: C.axis }, splitLine: { lineStyle: { color: '#eee7d6' } } },
    series: [{ type: 'bar', data: (charts.bookingTrend || []).map((d) => d.count), itemStyle: { color: C.gold, borderRadius: [3, 3, 0, 0] }, barWidth: '55%' }],
  };
  const recordOption = {
    grid: { left: 32, right: 12, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: dates(charts.recordTrend), axisLabel: { fontSize: 10, color: C.axis }, axisLine: { lineStyle: { color: C.axis } } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10, color: C.axis }, splitLine: { lineStyle: { color: '#eee7d6' } } },
    series: [{ type: 'line', smooth: true, symbolSize: 5, data: (charts.recordTrend || []).map((d) => d.count), itemStyle: { color: C.green }, lineStyle: { color: C.green, width: 2 }, areaStyle: { color: 'rgba(58,157,107,0.12)' } }],
  };
  const statusOption = {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 11, color: C.text } },
    color: [C.orange, C.green, C.red, C.gold],
    series: [{ type: 'pie', radius: ['42%', '66%'], center: ['50%', '44%'], avoidLabelOverlap: true, label: { fontSize: 11, color: C.text }, data: (charts.statusBreakdown || []).map((d) => ({ name: d.name, value: d.value })) }],
  };
  const hBar = (data, color) => {
    const items = (data || []).slice().reverse();
    return {
      grid: { left: 96, right: 24, top: 10, bottom: 10 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10, color: C.axis }, splitLine: { lineStyle: { color: '#eee7d6' } } },
      yAxis: { type: 'category', data: items.map((d) => d.name), axisLabel: { fontSize: 10, color: C.text }, axisLine: { lineStyle: { color: C.axis } } },
      series: [{ type: 'bar', data: items.map((d) => d.value), itemStyle: { color, borderRadius: [0, 3, 3, 0] }, barWidth: '55%' }],
    };
  };
  return { bookingOption, recordOption, statusOption, courseOption: hBar(charts.courseDist, C.gold), teacherOption: hBar(charts.teacherWorkload, C.green) };
}

export default function Dashboard({ user }) {
  const navigate = useNavigate();
  const role = user?.role || currentUser()?.role || 'admin';
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);

  useEffect(() => {
    if (role === 'admin') {
      api.stats().then(setStats).catch(() => {});
      api.charts().then(setCharts).catch(() => {});
    } else {
      Promise.all([api.teacherCourses(), api.teacherStudents(), api.teacherRecords()])
        .then(([c, s, r]) => setStats({ members: s.length, courses: c.length, bookings: 0, pendingBookings: 0, records: r.length, availableSlots: 0 }))
        .catch(() => {});
    }
  }, [role]);

  if (!stats) return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>数据概览</Typography.Title>
      <Empty description="加载中…（请确保后端服务已启动于 3001 端口）" />
    </>
  );

  const cards = [
    { l: '会员总数', n: stats.members, to: '/students' },
    { l: '在售课程', n: stats.courses, to: '/courses' },
    { l: '累计预约', n: stats.bookings, to: '/records' },
    { l: '待确认预约', n: stats.pendingBookings, to: '/records' },
    { l: '已完成课时', n: stats.records, to: '/records' },
    { l: '可约时段', n: stats.availableSlots, to: '/schedule' },
  ];
  const opt = charts ? buildOptions(charts) : null;
  // 注意：charts 可能尚未返回（或教师角色根本不请求图表），此时 opt 为 null
  // 必须先判空再取字段，否则会抛 Cannot read properties of null (reading 'bookingOption')
  const chartCards = opt ? [
    ['近 14 天预约趋势', opt.bookingOption, 240],
    ['近 14 天上课趋势', opt.recordOption, 240],
    ['预约状态分布', opt.statusOption, 220],
    ['各课程报名分布', opt.courseOption, 240],
    ['教师课时工作量', opt.teacherOption, 240],
  ] : [];

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>数据概览</Typography.Title>
      <Typography.Paragraph type="secondary">{role === 'admin' ? '工作室运营核心指标一览（点击卡片可跳转）' : '我的教学概览'}</Typography.Paragraph>

      <Row gutter={[16, 16]}>
        {cards.map((c) => (
          <Col key={c.l} xs={12} sm={8} lg={4}>
            <Card hoverable className="stat-click" onClick={() => navigate(c.to)} styles={{ body: { padding: '18px 20px' } }}>
              <Statistic title={c.l} value={c.n} styles={{ content: { color: '#a8843a', fontWeight: 700 } }} />
            </Card>
          </Col>
        ))}
      </Row>

      {role === 'admin' && (charts ? (
        <div className="chart-grid">
          {chartCards.map(([title, option, height]) => (
            <Card key={title} size="small" title={title} className="chart-card">
              <EChart option={option} height={height} />
            </Card>
          ))}
        </div>
      ) : (
        <Card size="small" style={{ marginTop: 16 }}>
          <Empty description="图表数据加载中…（若长时间空白，请确认后端 /api/admin/charts 正常）" />
        </Card>
      ))}
    </>
  );
}
