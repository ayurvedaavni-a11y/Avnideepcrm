import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  base: "./",  // Required for Electron file:// protocol
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "AVNIDEEP CRM PRO",
        short_name: "AVNIDEEP CRM",
        description:
          "Offline COD Ecommerce Business Management — Admin & Telecaller CRM with cloud sync.",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "./",
        scope: "./",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Web Push handlers (callback reminders) — injected into the generated
        // service worker. Lives in public/ so it's copied to dist root.
        importScripts: ["push-handler.js"],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Heavy vendor libraries → separate chunks for caching
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-dexie': ['dexie', 'dexie-react-hooks'],
        },
      },
    },
  },
});
