import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Separate from `vite.config.ts` on purpose: the vinext/Cloudflare plugins
 * transform for RSC + Workers and would try to resolve a Worker environment.
 * Everything tested here is either a pure function (codec, transcript reducer)
 * or a static render of the transcript, so plain Node is enough.
 */
export default defineConfig({
  // The render test uses JSX. In the app, vinext's plugin chain provides this
  // transform; here it has to be explicit.
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json, so the vendored
    // brainless components resolve their `@/lib/utils` import.
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
