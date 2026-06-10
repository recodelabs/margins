// roughneck gatekeeper — stands up Roughdraft's exported app behind a confinement
// guard, then listens directly. Running our own listener (instead of Roughdraft's
// createServer) lets us bind the LAN without a token AND own the security boundary,
// so Roughdraft updates import cleanly. Launched by the roughneck CLI.
import http from "node:http";
import path from "node:path";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const port = Number.parseInt(arg("--port", "7375"), 10);
const host = arg("--host", "0.0.0.0");
const projectDir = path.resolve(arg("--project-dir", process.cwd()));
const rdRoot = arg("--rd-root", "");
if (!rdRoot) { console.error("roughneck-server: --rd-root is required"); process.exit(1); }

// Import express from Roughdraft's own node_modules (it is not installed in roughneck).
// `import express from "express"` does not resolve from roughneck's directory.
const { default: express } = await import(
  path.join(rdRoot, "node_modules/express/index.js")
);

// Import Roughdraft's app factory by absolute path. Fail LOUD if the export is gone
// after an upgrade — never degrade into an unconfined server.
let createApp;
try {
  ({ createApp } = await import(path.join(rdRoot, "packages/server/dist/index.js")));
} catch (e) {
  console.error("roughneck-server: cannot import Roughdraft createApp from " + rdRoot, e);
  process.exit(1);
}
if (typeof createApp !== "function") {
  console.error("roughneck-server: Roughdraft no longer exports createApp — aborting");
  process.exit(1);
}

const { app: rd } = createApp({ port, projectDir });

// NOTE: string-prefix check on the resolved path. A symlink inside projectDir whose
// realpath escapes would pass this; acceptable for v1 (trusted repo content). Harden
// with fs.realpath if we ever serve untrusted repos.
// True iff `resolved` is the folder itself or lives inside it.
function inside(resolved) {
  return resolved === projectDir || resolved.startsWith(projectDir + path.sep);
}

const parent = express();
parent.use((req, res, next) => {
  if (req.path.startsWith("/api/remote-document")) return res.sendStatus(404);
  if (req.path.startsWith("/api/")) {
    const u = new URL(req.url, "http://localhost");
    const rel = u.searchParams.get("path");
    if (rel != null && !inside(path.resolve(projectDir, rel))) return res.sendStatus(403);
    u.searchParams.set("projectPath", projectDir); // pin: ignore client-supplied root
    req.url = u.pathname + u.search;               // rewrite so the mounted app re-parses
  }
  next();
});
parent.use(rd);

http.createServer(parent).listen(port, host, () => {
  console.log(`roughneck-server: ${host}:${port} -> ${projectDir}`);
});
