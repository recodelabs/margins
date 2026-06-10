import { exchangeCodeForToken } from "../../../auth/exchange";

interface Env { GITHUB_CLIENT_ID: string; GITHUB_CLIENT_SECRET: string; }

export const onRequestGet: (ctx: {
  request: Request; env: Env;
}) => Promise<Response> = async ({ request, env }) => {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/login")) {
    const authorize = new URL("https://github.com/login/oauth/authorize");
    authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
    authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
    authorize.searchParams.set("state", url.searchParams.get("state") || "");
    return Response.redirect(authorize.toString(), 302);
  }
  if (url.pathname.endsWith("/callback")) {
    const token = await exchangeCodeForToken(url.searchParams.get("code") || "", {
      clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET,
    });
    return Response.redirect(`${url.origin}/#token=${encodeURIComponent(token)}`, 302);
  }
  return new Response("Not found", { status: 404 });
};
