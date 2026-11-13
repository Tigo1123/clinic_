import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vendor chunks are matched by package path so each library lands in a stable,
// long-cacheable file. Each regex is anchored to the package directory name
// (trailing slash), so e.g. `react` does not swallow `react-dom`.
const vendorGroups = [
  {
    name: 'react-vendor',
    test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/,
  },
  {
    name: 'mui',
    test: /node_modules[\\/](@mui|@emotion|stylis)[\\/]/,
  },
  // recharts is intentionally not grouped: AnalyticsPanel is lazy-loaded, so
  // recharts already lands in its own on-demand chunk.
  {
    name: 'socket',
    test: /node_modules[\\/](socket\.io-client|engine\.io-client|socket\.io-parser)[\\/]/,
  },
  {
    name: 'i18n',
    test: /node_modules[\\/](i18next|react-i18next)[\\/]/,
  },
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Keep the default includeDependenciesRecursively (true): setting it to
          // false broke module execution order (MUI pages crashed with
          // "TypeError: s is not a function" at runtime).
          groups: vendorGroups,
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
