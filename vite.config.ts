import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Force cache bust - v20251209
const CACHE_VERSION = Date.now();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Force fresh modules in dev
    hmr: {
      overlay: true,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "pwa-192x192.png", "pwa-512x512.png"],
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
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Skip caching JS files to prevent stale React
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.the-odds-api\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "odds-api-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 10
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force single copy of React packages
    dedupe: [
      "react", 
      "react-dom", 
      "react-router-dom", 
      "@tanstack/react-query",
      "framer-motion"
    ],
  },
  optimizeDeps: {
    // Force re-bundle on every server start
    force: true,
    // Pre-bundle all React-related deps together
    include: [
      "react", 
      "react-dom", 
      "react-dom/client",
      "react-router-dom", 
      "@tanstack/react-query",
      "framer-motion"
    ],
    // Ensure consistent React resolution
    esbuildOptions: {
      // Force consistent JSX runtime
      jsx: "automatic",
    },
  },
  build: {
    // Single vendor chunk for React ecosystem
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': [
            'react', 
            'react-dom', 
            'react-router-dom',
            '@tanstack/react-query'
          ],
        },
      },
    },
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
}));
