import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "parlay-farm-logo.png", "pwa-192x192.png", "pwa-512x512.png"],
      manifest: {
        name: "Parlay Farm - Track Sharps, Tail Winners",
        short_name: "Parlay Farm",
        description: "Upload your parlay slip, get AI analysis, track sharp money movements, and discover winning strategies.",
        theme_color: "#0a0c10",
        background_color: "#0a0c10",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable"
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ],
        categories: ["sports", "entertainment", "finance"],
        screenshots: [],
        shortcuts: [
          {
            name: "Upload Slip",
            short_name: "Upload",
            url: "/upload",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "AI Picks",
            short_name: "Picks",
            url: "/suggestions",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Track Odds",
            short_name: "Odds",
            url: "/odds",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ["**/*.{css,html,ico,png,svg,woff2}"],
        navigateFallback: null,
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Force single React instance
      "react": path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(__dirname, "node_modules/react/jsx-runtime"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "node_modules/react/jsx-dev-runtime"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    force: true,
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
}));
