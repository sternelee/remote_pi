import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

/**
 * `vite-plugin-pwa` configuration notes
 *
 * This app is not a stock Vite SPA: HTML is server-rendered by vinext (there is
 * no `index.html` to transform), and the client build runs as one environment of
 * an RSC/Cloudflare multi-environment build. So:
 *
 *   - `injectRegister: null` — the plugin has no HTML to inject the registration
 *     script into. Registration stays in `useServiceWorker()` (PROD only).
 *   - `outDir: "dist/client"` — the client bundle is emitted there, not at the
 *     Vite default `dist`.
 *   - `globPatterns` deliberately excludes `.js`. The Shiki plugin emits ~300
 *     lazy chunks (~11 MB) under `_next/static/chunks`; precaching all of them
 *     would make install huge. Hashed assets are runtime-cached cache-first
 *     instead (they are immutable), mirroring the previous hand-written worker.
 *   - `navigateFallback: undefined` — there is no `index.html` to fall back to,
 *     and a precache-first navigation route would break the live app. The only
 *     document is `/` (routing is hash-based), served network-first with a
 *     cached copy for offline reloads.
 */
export default defineConfig({
  plugins: [
    vinext({
      prerender: { routes: "*" },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
    // `VitePWA` returns several plugins and is not environment-aware: left
    // unscoped it also emits the manifest into the SSR/RSC bundles (a stray
    // `dist/server/manifest.webmanifest`). Scope every one of its plugins to
    // the client environment, which is the only one that produces web assets.
    ...VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      injectRegister: null,
      outDir: "dist/client",
      // Icons and the manifest are already matched by `globPatterns`; without
      // this the plugin adds the manifest icons a second time.
      includeManifestIcons: false,
      manifest: {
        name: "Remote Pi",
        short_name: "Remote Pi",
        description:
          "Browser client for the Pi coding agent — pair over the relay and watch the session live.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        orientation: "any",
        background_color: "#0d0d0d",
        theme_color: "#0d0d0d",
        categories: ["developer", "productivity", "utilities"],
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        // `webmanifest` is intentionally absent: the plugin precaches the
        // manifest itself, so globbing it too would duplicate the entry.
        globPatterns: ["**/*.{css,svg,png,ico}"],
        navigateFallback: undefined,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The only document is `/`; hash routing never hits the server.
            urlPattern: /\/$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "remote-pi-shell",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Content-hashed, immutable Vite output.
            urlPattern: /\/_next\/static\//,
            handler: "CacheFirst",
            options: {
              cacheName: "remote-pi-assets",
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }).map((plugin) => ({
      ...plugin,
      applyToEnvironment: (environment: { name: string }) => environment.name === "client",
    })),
  ],
});
