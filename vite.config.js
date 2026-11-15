import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 站点部署在 /goldenkeyadmin/ 下（主站 rongyuevideo.com 的路径），
// 接口统一在 /goldenkey/api 下，两者刻意不同：页面挂在 goldenkeyadmin，接口挂在 goldenkey。
// 需要换路径时构建前设置 VITE_BASE（例如 VITE_BASE=/goldenkey/ npm run build），
// 路由 basename 会自动跟随 import.meta.env.BASE_URL。
const BASE = process.env.VITE_BASE || '/goldenkeyadmin/';

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
      // 只代理接口，不要把页面自身（/goldenkeyadmin/）也转发走；
      // 后端路径完全相同，无需改写
      '/goldenkey/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
