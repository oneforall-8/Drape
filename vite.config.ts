import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" lets the same build work on any GitHub Pages path (user.github.io/repo/).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
