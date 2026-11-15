import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端地址可由环境变量覆盖，方便本地开发在「容器后端」和「本地后端」之间切换：
//   连容器（默认）：npm run dev
//   连本地后端  ：VITE_API_TARGET=http://127.0.0.1:3101 npm run dev
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 监听 0.0.0.0，手机/其他设备也能访问 dev server
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
