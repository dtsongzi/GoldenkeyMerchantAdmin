import { useEffect, useState } from 'react';
import { Button, ConfigProvider, DatePicker } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
dayjs.locale('zh-cn');

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// 根据占比返回热力背景色（金色调，由浅到深）
function heatColor(ratio) {
  if (ratio <= 0) return '#f7f5f0';
  if (ratio < 0.25) return '#f2e4bf';
  if (ratio < 0.5) return '#e7cd8c';
  if (ratio < 0.75) return '#d9b357';
  return '#c9a24b';
}

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

// 课时分布日历：自绘月历 + antd 月份选择器 + 左右切换箭头
export function CalendarHeat({ distribution = [] }) {
  const map = {};
  distribution.forEach((d) => {
    const c = Number(d.count) || 0;
    map[d.date] = (map[d.date] || 0) + c;
  });
  const dates = Object.keys(map).sort();
  const max = Math.max(1, ...dates.map((d) => map[d]));
  const latest = dates.length ? dates[dates.length - 1].slice(0, 7) : ymd(new Date()).slice(0, 7);

  // hooks 必须放在任何早返回之前，避免 distribution 由空变非空时 hook 数量变化
  const [ym, setYm] = useState(latest);
  useEffect(() => { setYm(latest); }, [latest]);

  if (!distribution.length) return <div className="heat-empty">暂无课时分布</div>;

  const shiftMonth = (n) => setYm(dayjs(`${ym}-01`).add(n, 'month').format('YYYY-MM'));
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const startDay = (first.getDay() + 6) % 7; // 周一为一周开始
  const daysInMonth = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const todayStr = ymd(new Date());
  const monthHasData = dates.some((d) => d.startsWith(ym));

  return (
    <div className="cal-heat">
      <div className="cal-picker-row">
        <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#c9a24b' } }}>
          <div className="cal-month-nav">
            <Button icon={<LeftOutlined />} aria-label="上一个月" onClick={() => shiftMonth(-1)} />
            <DatePicker
              picker="month"
              allowClear={false}
              value={dayjs(`${ym}-01`)}
              format="YYYY年M月"
              onChange={(d) => { if (d) setYm(d.format('YYYY-MM')); }}
            />
            <Button icon={<RightOutlined />} aria-label="下一个月" onClick={() => shiftMonth(1)} />
          </div>
        </ConfigProvider>
        <span className="cal-legend">
          <i style={{ background: '#f7f5f0', borderColor: '#e6e0d4' }} />
          <i style={{ background: '#c9a24b' }} />
          <em>少 → 多</em>
        </span>
      </div>

      <div className="cal-grid">
        {WEEK.map((w) => (
          <div key={w} className="cal-wd">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={i} className="cal-cell empty" />;
          const ds = `${ym}-${String(d).padStart(2, '0')}`;
          const c = map[ds] || 0;
          const ratio = c / max;
          const isToday = ds === todayStr;
          const hasData = c > 0;
          const dark = ratio >= 0.75;
          return (
            <div
              key={i}
              className={'cal-cell' + (isToday ? ' today' : '') + (hasData ? ' has' : '')}
              style={{ background: heatColor(ratio), color: dark ? '#fff' : '#5a544a' }}
              title={hasData ? `${ds}：${c} 课时` : `${ds}：无排课`}
            >
              <span className="cal-d">{d}</span>
              {hasData && <span className="cal-n">{c}</span>}
            </div>
          );
        })}
      </div>

      {!monthHasData && <div className="cal-note">本月暂无课时记录，可切换其它月份查看</div>}
    </div>
  );
}
