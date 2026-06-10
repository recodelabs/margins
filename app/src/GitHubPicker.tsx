import { useEffect, useState } from "react";
import { login, getStoredToken } from "./github-auth";
import { GitHubBackend } from "./github-backend";

export function GitHubPicker() {
  const params = new URLSearchParams(window.location.search);
  const token = getStoredToken();
  const [repo, setRepo] = useState(params.get("repo") || "");
  const [ref, setRef] = useState(params.get("ref") || "main");
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If we have a token + repo but no file chosen, list the markdown files.
  useEffect(() => {
    const [owner, name] = repo.split("/");
    if (!token || !owner || !name) return;
    const backend = new GitHubBackend({ token, owner, repo: name, branch: ref, login: "" });
    let cancelled = false;
    setError(null);
    backend.listMarkdownPaths()
      .then((p) => { if (!cancelled) setPaths(p); })
      .catch((e) => { if (!cancelled) setError(String(e instanceof Error ? e.message : e)); });
    return () => { cancelled = true; };
  }, [token, repo, ref]);

  if (!token) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", fontFamily: "system-ui" }}>
        <h1>roughneck</h1>
        <p>Review a GitHub repo's markdown in your browser.</p>
        <button onClick={login}>Login with GitHub</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "64px auto", fontFamily: "system-ui" }}>
      <h1>Pick a repo</h1>
      <p>
        <label>owner/repo{" "}
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="octocat/hello" />
        </label>{" "}
        <label>branch{" "}
          <input value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {(paths || []).map((p) => {
          const href = `/?repo=${encodeURIComponent(repo)}&ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(p)}`;
          return <li key={p}><a href={href}>{p}</a></li>;
        })}
      </ul>
      {paths && paths.length === 0 && <p>No markdown files found.</p>}
    </div>
  );
}
