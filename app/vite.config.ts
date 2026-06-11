import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { exchangeCodeForToken } from "../auth/exchange";

// Minimal structural type so we don't depend on @types/node here (this file is
// loaded by esbuild and isn't part of the tsc project).
type ReadableReq = { on(event: string, listener: (chunk?: unknown) => void): void };

function readJsonBody(req: ReadableReq): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function authDevPlugin(env: Record<string, string>) {
  return {
    name: "roughneck-auth-dev",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const host = (req.headers && (req.headers as Record<string, string>)["host"]) || "localhost";
        const url = new URL(req.url || "", `http://${host}`);
        if (url.pathname === "/api/auth/login") {
          const redirectUri = `${url.origin}/api/auth/callback`;
          const authorize = new URL("https://github.com/login/oauth/authorize");
          authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID || "");
          authorize.searchParams.set("redirect_uri", redirectUri);
          authorize.searchParams.set("state", url.searchParams.get("state") || "");
          res.statusCode = 302;
          res.setHeader("Location", authorize.toString());
          res.end();
          return;
        }
        if (url.pathname === "/api/auth/callback") {
          // Forward the single-use OAuth `code` (and `state`) to the SPA — never the
          // access token. Mirrors the Cloudflare Function in functions/api/auth/.
          const code = url.searchParams.get("code") || "";
          const state = url.searchParams.get("state") || "";
          res.statusCode = 302;
          res.setHeader("Location", `/?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
          res.end();
          return;
        }
        if (url.pathname === "/api/auth/token" && (req.method || "").toUpperCase() === "POST") {
          try {
            const body = await readJsonBody(req);
            const token = await exchangeCodeForToken((body as { code?: string }).code || "", {
              clientId: env.GITHUB_CLIENT_ID || "",
              clientSecret: env.GITHUB_CLIENT_SECRET || "",
            });
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ access_token: token }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e instanceof Error ? e.message : e));
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = parseInt(process.env.API_PORT || "3001", 10);

  return {
    plugins: [tailwindcss(), react(), authDevPlugin(env)],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    build: {
      outDir: "dist",
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Split heavy vendor groups into their own chunks so the editor
          // stack stays out of the initial (login/homepage) bundle and is
          // cached independently. Lazy boundaries (React.lazy) decide what
          // loads up front; this just keeps the chunks cleanly separated.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/.test(
                id,
              )
            ) {
              // Keep React and its shared companions (used by both the eager UI
              // libs and the lazy editor) in one eager chunk so they don't get
              // pulled into a lazy vendor chunk and loaded up front.
              return "react-vendor";
            }
            if (id.includes("@tiptap") || id.includes("prosemirror")) {
              return "tiptap";
            }
            if (id.includes("@codemirror") || id.includes("@lezer")) {
              return "codemirror";
            }
            if (id.includes("turndown") || id.includes("/marked")) {
              return "markdown-serialize";
            }
            return undefined;
          },
        },
      },
    },
    server: {
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
  };
});
