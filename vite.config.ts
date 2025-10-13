import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	server: {
		host: true,
		proxy: {
			'/ldark-api': {
				target: 'https://ldark-star.ru',
				changeOrigin: true,
				secure: false,
				rewrite: (path) => path.replace(/^\/ldark-api/, '')
			}
		}
	}
});
