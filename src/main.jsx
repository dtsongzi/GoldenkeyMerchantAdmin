import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App.jsx';
import './styles.css';

dayjs.locale('zh-cn');

// 站点路径 /goldenkeyadmin/，路由基准直接取 Vite 的 BASE_URL，
// 和 vite.config.js 的 base 永远一致（换路径不会一边改一边忘）
const BASENAME = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#c9a24b', borderRadius: 8, fontSize: 14 } }}>
      <AntApp>
        <BrowserRouter basename={BASENAME}>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
