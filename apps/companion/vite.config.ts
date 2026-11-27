import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Relative paths so the built app runs from any folder or host (Cloudflare Pages, a USB stick, a preview link).
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "Mimic Box",
        short_name: "Mimic Box",
        description: "A free character sheet that lives on your device.",
        theme_color: "#241A26",
        background_color: "#241A26",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // Precache everything, including the spell list, so the sheet works fully offline after the first visit.
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,json}"],
        // Except the DM's bestiary: players never need it. The studio fetches it whenever it's online, and this
        // keeps it on the DM's device for play without internet.
        globIgnores: ["**/monsters-*.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/monsters-[^/]*\.js$/.test(url.pathname),
            handler: "CacheFirst",
            options: { cacheName: "mimicbox-bestiary", expiration: { maxEntries: 4 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/studio\.html/, /display\.html/],
        // A self-hosted relay is given as ?relay=…; the page is the same one, so serve it from the cache offline too.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^relay$/],
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    // Three pages, three bundles: players never download the DM's code.
    rollupOptions: {
      input: {
        index: "index.html",
        studio: "studio.html",
        display: "display.html",
      },
    },
  },
});
