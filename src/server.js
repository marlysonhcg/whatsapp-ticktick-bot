// Servidor HTTP que recebe o webhook da Evolution API e responde pelo WhatsApp.

import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { EvolutionClient, parseIncoming } from "./evolution.js";
import { Assistant, friendlyError } from "./claude.js";

const config = loadConfig();
const evolution = new EvolutionClient(config);
const assistant = new Assistant(config);

const WEBHOOK_PATH = `/webhook/${config.webhookSecret}`;
const RESET_COMMANDS = new Set(["/novo", "/reset", "novo assunto"]);

// A Evolution pode reenviar o mesmo evento; guarda os IDs recentes para não responder duas vezes.
const seenIds = new Set();
function alreadySeen(id) {
  if (!id) return false;
  if (seenIds.has(id)) return true;
  seenIds.add(id);
  if (seenIds.size > 1000) seenIds.delete(seenIds.values().next().value);
  return false;
}

// Mensagens do mesmo contato são processadas uma de cada vez, na ordem em que chegaram.
const queues = new Map();
function enqueue(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(task, task).finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  queues.set(key, next);
}

async function handleMessage(msg) {
  const userKey = msg.numbers.find((n) => config.allowedNumbers.has(n));
  // Responde pelo número de telefone (funciona mesmo quando o chat chega como @lid).
  const to = userKey ?? msg.remoteJid;

  if (msg.isAudio && !msg.text) {
    await evolution.sendText(to, "Por enquanto eu só entendo mensagens de texto. 🙂");
    return;
  }
  if (!msg.text) return;

  if (RESET_COMMANDS.has(msg.text.toLowerCase())) {
    assistant.reset(userKey);
    await evolution.sendText(to, "Pronto, começamos uma conversa nova.");
    return;
  }

  await evolution.typing(to);
  const typingTimer = setInterval(() => evolution.typing(to), 8000);
  try {
    const answer = await assistant.reply(userKey, msg.text);
    await evolution.sendText(to, answer);
  } catch (error) {
    console.error(`[erro] ao responder ${maskNumber(userKey)}:`, error);
    await evolution.sendText(to, friendlyError(error)).catch(() => {});
  } finally {
    clearInterval(typingTimer);
  }
}

function maskNumber(n = "") {
  return n.length > 4 ? `${"*".repeat(n.length - 4)}${n.slice(-4)}` : n;
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }
  // Aceita tanto /webhook/SEGREDO quanto /webhook/SEGREDO/messages-upsert (byEvents).
  if (req.method !== "POST" || !req.url?.startsWith(WEBHOOK_PATH)) {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 5_000_000) req.destroy();
  });
  req.on("end", () => {
    // Responde 200 na hora; o processamento continua em segundo plano.
    res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return;
    }
    const msg = parseIncoming(payload);
    if (!msg || alreadySeen(msg.id)) return;

    const allowed = msg.numbers.some((n) => config.allowedNumbers.has(n));
    if (!allowed) {
      console.log(`[ignorado] mensagem de número não autorizado (${msg.numbers.map(maskNumber).join(", ") || msg.remoteJid})`);
      return;
    }
    enqueue(msg.remoteJid, () => handleMessage(msg));
  });
});

server.listen(config.port, () => {
  console.log(`Bot no ar na porta ${config.port}. Webhook: ${WEBHOOK_PATH.replace(config.webhookSecret, "<WEBHOOK_SECRET>")}`);
  console.log(`Números autorizados: ${[...config.allowedNumbers].map(maskNumber).join(", ")}`);
});
