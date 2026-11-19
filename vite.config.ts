import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiPort = process.env.PORT ?? "3001";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  // Static (GitHub Pages) builds use relative asset URLs so the site works under any sub-path.
  const isStatic = env.VITE_DATA_MODE === "github-direct";
  // Allow the page to call the sign-in helper (Content-Security-Policy in index.html).
  let helperOrigin = "";
  if (env.VITE_AUTH_HELPER_URL) helperOrigin = new URL(env.VITE_AUTH_HELPER_URL).origin;

  return {
    base: isStatic ? "./" : "/",
    plugins: [
      react(),
      tailwindcss(),
      { name: "csp-auth-helper", transformIndexHtml: (html: string) => html.replace("__AUTH_HELPER_ORIGIN__", helperOrigin).replace(" ;", ";") },
    ],
    server: {
      port: 5173,
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 800,
    },
    test: {
      include: ["tests/**/*.test.{ts,tsx}"],
      environment: "node",
      setupFiles: ["tests/setup.ts"],
    },
  };
});
