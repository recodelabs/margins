import { handlePublicDoc } from "../../../lib/public-doc";

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}

export const onRequestGet: (ctx: {
  request: Request;
  env: Env;
}) => Promise<Response> = async ({ request, env }) => {
  const url = new URL(request.url);
  return handlePublicDoc(env, {
    owner: url.searchParams.get("owner") || "",
    repo: url.searchParams.get("repo") || "",
    path: url.searchParams.get("path") || "",
  });
};
