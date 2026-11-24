// Confere se as três conexões estão funcionando: Evolution, TickTick e Anthropic.
// Uso:  npm run check

import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
let failures = 0;

async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`✅ ${name}${detail ? ` - ${detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`❌ ${name} - ${error.message}`);
  }
}

await step("Evolution API", async () => {
  const res = await fetch(
    `${config.evolutionUrl}/instance/connectionState/${encodeURIComponent(config.evolutionInstance)}`,
    { headers: { apikey: config.evolutionApiKey }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} (confira EVOLUTION_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE)`);
  const body = await res.json();
  const state = body?.instance?.state ?? body?.state ?? "desconhecido";
  if (state !== "open") throw new Error(`instância encontrada, mas o WhatsApp não está conectado (estado: ${state}). Leia o QR Code no painel da Evolution.`);
  return "WhatsApp conectado";
});

await step("TickTick (MCP)", async () => {
  const res = await fetch(config.ticktickMcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.ticktickToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "whatsapp-ticktick-bot-check", version: "1.0.0" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("token recusado. Rode `npm run ticktick-login` de novo.");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return "token aceito";
});

await step("Anthropic API", async () => {
  const client = new Anthropic();
  const model = await client.models.retrieve(config.anthropicModel);
  return `modelo ${model.id} disponível`;
});

if (config.groqApiKey) {
  await step("Groq (áudio)", async () => {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} (confira GROQ_API_KEY)`);
    return "chave aceita";
  });
} else {
  console.log("➖ Groq (áudio) - desligado, sem GROQ_API_KEY");
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : "\nTudo certo! Pode subir o bot.");
process.exit(failures ? 1 : 0);
