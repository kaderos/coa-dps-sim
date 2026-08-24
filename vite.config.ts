import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  root: ".",
  publicDir: "public",
  base: mode === "production" ? "/coa-dps-sim/" : "/",
  server: {
    port: 5173,
    strictPort: true,
    // "::" binds dual-stack so both 127.0.0.1 and ::1 answer. Chrome resolves
    // localhost to ::1 first, and an IPv4-only bind gets refused there.
    host: "::",
    fs: {
      deny: ["vendor/**"],
    },
    watch: {
      ignored: ["**/vendor/**", "**/data/bisbeard/bisbeard-*.json"],
    },
  },
  // vendor/ holds a read-only clone of wowsims/classic for reference; its imports
  // are not installed here, so keep the dep scanner out of it.
  optimizeDeps: {
    entries: ["index.html", "src/**/*.ts"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
