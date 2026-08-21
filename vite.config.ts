import { defineConfig } from "vite";

export default defineConfig({
  base: "/million-de-pixels/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  worker: {
    format: "es",
  },
});
