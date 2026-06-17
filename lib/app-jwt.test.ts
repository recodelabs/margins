import { describe, expect, it } from "vitest";
import { createAppJwt } from "./app-jwt";

function pemFromDer(der: ArrayBuffer, label: string): string {
  const b64 = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

async function genKeys() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    privateKeyPem: pemFromDer(pkcs8, "PRIVATE KEY"),
    publicKey: pair.publicKey,
  };
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(s.length / 4) * 4, "=");
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

describe("createAppJwt", () => {
  it("produces a verifiable RS256 JWT with iss/iat/exp", async () => {
    const { privateKeyPem, publicKey } = await genKeys();
    const jwt = await createAppJwt("123456", privateKeyPem);

    const [h, p, s] = jwt.split(".");
    const header = JSON.parse(Buffer.from(b64urlToBytes(h)).toString("utf8"));
    const payload = JSON.parse(Buffer.from(b64urlToBytes(p)).toString("utf8"));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(payload.iss).toBe("123456");
    expect(payload.exp).toBeGreaterThan(payload.iat);

    const ok = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });
});
