import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 站点挂在 /goldenkey/ 下（与接口前缀 /goldenkey/api 一致，避免和同机其它应用冲突）。
// 开发访问地址也随之变成 http://localhost:5173/goldenkey/
const BASE = '/goldenkey/';

// 后端地址可由环境变量覆盖：
//   连本地后端（默认）：npm run dev
//   换后端地址        ：VITE_API_TARGET=http://127.0.0.1:3101 npm run dev
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 监听 0.0.0.0，手机/其他设备也能访问 dev server
    proxy: {
      // 只代理接口，不要把页面自身（/goldenkey/）也转发走；
      // 后端路径完全相同，无需改写
      '/goldenkey/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
