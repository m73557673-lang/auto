import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const backendEnv = loadEnv(mode, './backend', '');
  const apiToken = backendEnv.COMMANDER_API_TOKEN;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest, request) => {
              if (apiToken && !request.headers.authorization) {
                proxyRequest.setHeader('Authorization', `Bearer ${apiToken}`);
              }
            });
          },
        },
      },
    },
  };
});