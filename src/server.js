// Servidor HTTP que recebe o webhook da Evolution API e responde pelo WhatsApp.

import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { EvolutionClient, parseIncoming } from "./evolution.js";
import { Assistant, friendlyError } from "./claude.js";
import { transcribe } from "./transcribe.js";
import { deleteTasks } from "./ticktick-mcp.js";
import { startDailySummary } from "./scheduler.js";
import { startReminders } from "./reminders.js";

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

const CONFIRM_DELETE = /^\s*(sim|s|confirmo|confirmado|pode( sim)?( apagar| excluir)?|apaga|exclui)\s*[.!]*\s*$/i;

async function handleMessage(msg) {
  const userKey = msg.numbers.find((n) => config.allowedNumbers.has(n));
  // Responde pelo número de telefone (funciona mesmo quando o chat chega como @lid).
  const to = userKey ?? msg.remoteJid;

  let text = msg.text;
  let prefix = "";

  if (msg.isAudio && !text) {
    if (!config.groqApiKey) {
      await evolution.sendText(to, "Ainda não consigo ouvir áudios. Mande por texto, por favor. 🙂");
      return;
    }
    await evolution.typing(to);
    try {
      const media = await evolution.getMedia(msg.id);
      const transcript = await transcribe(media.data, media.mimetype, config.groqApiKey);
      if (!transcript) {
        await evolution.sendText(to, "Não consegui entender o áudio. Pode repetir ou mandar por texto?");
        return;
      }
      text = `[áudio transcrito] ${transcript}`;
      prefix = `🎤 _${transcript}_\n\n`;
    } catch (error) {
      console.error("[erro] ao transcrever áudio:", error?.message ?? error);
      await evolution.sendText(to, "⚠️ Não consegui transcrever o áudio agora. Pode mandar por texto?");
      return;
    }
  }
  if (!text) return;

  if (RESET_COMMANDS.has(text.toLowerCase())) {
    assistant.reset(userKey);
    await evolution.sendText(to, "Pronto, começamos uma conversa nova.");
    return;
  }

  // Exclusão: só acontece aqui, quando há um pedido pendente E o usuário confirma com SIM.
  const pending = assistant.takePendingDeletion(userKey);
  if (pending && CONFIRM_DELETE.test(msg.text ?? "")) {
    await evolution.typing(to);
    let answer;
    try {
      const { ok, failed } = await deleteTasks(config, pending);
      answer = [
        ok.length ? `🗑️ Excluí ${ok.length === 1 ? "a tarefa" : `${ok.length} tarefas`}:\n${ok.map((t) => `• ${t}`).join("\n")}` : "",
        failed.length ? `⚠️ Não consegui excluir:\n${failed.map((t) => `• ${t}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch (error) {
      console.error("[erro] ao excluir tarefas:", error?.message ?? error);
      answer = "⚠️ Não consegui acessar o TickTick para excluir. Nada foi apagado; tente de novo em instantes.";
    }
    assistant.recordExchange(userKey, msg.text, answer);
    await evolution.sendText(to, answer);
    return;
  }
  if (pending) {
    // Qualquer outra resposta cancela o pedido; o Claude fica sabendo.
    text = `(O pedido de exclusão anterior foi cancelado; nada foi excluído.)\n${text}`;
  }

  await evolution.typing(to);
  const typingTimer = setInterval(() => evolution.typing(to), 8000);
  try {
    const answer = await assistant.reply(userKey, text);
    await evolution.sendText(to, prefix + answer);
  } catch (error) {
    console.error(`[erro] ao responder ${maskNumber(userKey)}:`, error);
    await evolution.sendText(to, friendlyError(error)).catch(() => {});
  } finally {
    clearInterval(typingTimer);
  }
}

async function sendDailySummary(userKey, prompt) {
  assistant.reset(userKey); // o resumo abre uma conversa nova, para você responder em cima dele
  const answer = await assistant.reply(userKey, prompt);
  await evolution.sendText(userKey, answer);
  console.log(`[resumo] enviado para ${maskNumber(userKey)}`);
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
    const userKey = msg.numbers.find((n) => config.allowedNumbers.has(n));
    enqueue(userKey, () => handleMessage(msg));
  });
});

server.listen(config.port, () => {
  console.log(`Bot no ar na porta ${config.port}. Webhook: ${WEBHOOK_PATH.replace(config.webhookSecret, "<WEBHOOK_SECRET>")}`);
  console.log(`Números autorizados: ${[...config.allowedNumbers].map(maskNumber).join(", ")}`);
  console.log(`Áudio: ${config.groqApiKey ? "ligado (Groq)" : "desligado (sem GROQ_API_KEY)"}`);
  console.log(
    config.dailySummaryTime
      ? `Resumo diário: ${config.dailySummaryTime.label} (${config.timezone})`
      : "Resumo diário: desligado (sem DAILY_SUMMARY_TIME)",
  );
  console.log(
    config.reminderMinutes
      ? `Lembretes: ${config.reminderMinutes} min antes de cada tarefa com horário`
      : "Lembretes: desligados (REMINDER_MINUTES=0)",
  );
  startReminders(config, async (text) => {
    for (const userKey of config.allowedNumbers) {
      await evolution.sendText(userKey, text).catch((e) => console.error("[lembretes] envio falhou:", e?.message));
    }
  });
  // O resumo entra na mesma fila das mensagens do usuário, para não atropelar uma conversa.
  startDailySummary(config, (userKey, prompt) =>
    new Promise((resolve, reject) => enqueue(userKey, () => sendDailySummary(userKey, prompt).then(resolve, reject))),
  );
});
