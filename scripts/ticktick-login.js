// Faz o login no TickTick (OAuth com PKCE) e grava o token no arquivo .env.
// Rode no SEU computador (precisa de navegador):  npm run ticktick-login
//
// O TickTick permite cadastro automático do app (dynamic client registration),
// então não é preciso criar nada no portal de desenvolvedor.

import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "node:child_process";

const AUTH_SERVER = "https://ticktick.com";
const MCP_RESOURCE = (process.env.TICKTICK_MCP_URL?.trim() || "https://mcp.ticktick.com").replace(/\/*$/, "/");
const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "tasks:read tasks:write";
const ENV_FILE = new URL("../.env", import.meta.url);

const b64url = (buf) => buf.toString("base64url");

async function main() {
  const meta = await fetchJson(`${AUTH_SERVER}/.well-known/oauth-authorization-server`);

  console.log("1/3 Registrando o app no TickTick...");
  const client = await fetchJson(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Bot WhatsApp (uso pessoal)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  }).toString();

  const code = await waitForCode(authUrl.toString(), state);

  console.log("3/3 Trocando o código pelo token...");
  const tokenRes = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.client_id,
      code_verifier: verifier,
      resource: MCP_RESOURCE,
    }),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`O TickTick recusou a troca do código (HTTP ${tokenRes.status}): ${JSON.stringify(token)}`);
  }

  await saveToEnv("TICKTICK_TOKEN", token.access_token);
  const days = token.expires_in ? Math.round(token.expires_in / 86400) : null;
  console.log(
    `\nPronto! Token salvo no arquivo .env (TICKTICK_TOKEN).` +
      (days ? ` Ele vale por cerca de ${days} dias; depois disso, rode este comando de novo.` : ""),
  );
}

function waitForCode(authUrl, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const ok = !error && code && url.searchParams.get("state") === expectedState;
      res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        ok
          ? "<h2>TickTick conectado! Pode fechar esta aba e voltar ao terminal.</h2>"
          : "<h2>Não deu certo. Volte ao terminal para ver o erro.</h2>",
      );
      server.close();
      if (ok) resolve(code);
      else reject(new Error(error ? `TickTick retornou erro: ${error}` : "Resposta inválida (state não confere)."));
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log("2/3 Abra este link no navegador, entre no TickTick e autorize:\n");
      console.log(authUrl + "\n");
      openBrowser(authUrl);
    });
    server.on("error", reject);
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function saveToEnv(name, value) {
  let content = "";
  try {
    content = await readFile(ENV_FILE, "utf8");
  } catch {
    /* .env ainda não existe */
  }
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  content = re.test(content) ? content.replace(re, line) : `${content.replace(/\n?$/, "\n")}${line}\n`;
  await writeFile(ENV_FILE, content.replace(/^\n/, ""), { mode: 0o600 });
}

main().catch((err) => {
  console.error("\nErro:", err.message);
  process.exit(1);
});
