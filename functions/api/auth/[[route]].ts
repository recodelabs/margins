import { exchangeCodeForToken } from "../../../auth/exchange";

interface Env { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string; }

export const onRequestGet: (ctx: {
  request: Request; env: Env;
}) => Promise<Response> = async ({ request, env }) => {
  const url = new URL(request.url);
  // Auth responses must never be cached (a cached redirect/token is a correctness
  // and security hazard — and the edge will otherwise cache these on *.pages.dev).
  const noStore = { "Cache-Control": "no-store" };
  if (url.pathname === "/api/auth/login") {
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
    authorize.searchParams.set("state", url.searchParams.get("state") || "");
    return new Response(null, { status: 302, headers: { Location: authorize.toString(), ...noStore } });
  }
  if (url.pathname === "/api/auth/callback") {
    try {
      const token = await exchangeCodeForToken(url.searchParams.get("code") || "", {
        clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
      });
      const state = url.searchParams.get("state") || "";
      const location = `${url.origin}/#token=${encodeURIComponent(token)}&state=${encodeURIComponent(state)}`;
      return new Response(null, { status: 302, headers: { Location: location, ...noStore } });
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), { status: 500, headers: noStore });
    }
  }
  return new Response("Not found", { status: 404, headers: noStore });
};
