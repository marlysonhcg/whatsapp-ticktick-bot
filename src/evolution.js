// Integração com a Evolution API v2: leitura do webhook e envio de mensagens.

import { normalizeNumber } from "./config.js";

/**
 * Extrai uma mensagem de texto recebida de um payload de webhook "messages.upsert".
 * Retorna null para qualquer coisa que o bot deve ignorar.
 */
export function parseIncoming(payload) {
  const event = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  if (event !== "messages.upsert") return null;

  // Dependendo da versão, "data" vem como objeto ou como lista.
  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const key = data?.key;
  if (!key || key.fromMe) return null;

  const remoteJid = String(key.remoteJid ?? "");
  if (remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return null;

  // Em contas com endereçamento LID, o número real vem em remoteJidAlt/senderPn.
  const candidates = [remoteJid, key.remoteJidAlt, key.senderPn, data.senderPn]
    .filter(Boolean)
    .map(String)
    .filter((jid) => jid.endsWith("@s.whatsapp.net") || /^\d+$/.test(jid))
    .map((jid) => normalizeNumber(jid.split("@")[0]));

  const msg = data.message ?? {};
  const text =
    msg.conversation ??
    msg.extendedTextMessage?.text ??
    msg.imageMessage?.caption ??
    msg.videoMessage?.caption ??
    null;

  const isAudio = Boolean(msg.audioMessage);

  return {
    id: String(key.id ?? ""),
    remoteJid,
    numbers: [...new Set(candidates)],
    pushName: data.pushName ?? "",
    text: text?.trim() || null,
    isAudio,
  };
}

export class EvolutionClient {
  constructor({ evolutionUrl, evolutionApiKey, evolutionInstance }) {
    this.baseUrl = evolutionUrl;
    this.apiKey = evolutionApiKey;
    this.instance = encodeURIComponent(evolutionInstance);
  }

  async #post(path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Evolution ${path} respondeu ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  }

  /** Envia texto. "to" pode ser o JID completo ou só o número. */
  async sendText(to, text) {
    // O WhatsApp corta mensagens muito longas; divide em partes de ~3500 caracteres.
    for (const part of splitMessage(text, 3500)) {
      await this.#post(`/message/sendText/${this.instance}`, { number: to, text: part });
    }
  }

  /** Mostra "digitando..." enquanto o Claude trabalha. Falhas aqui são ignoradas. */
  async typing(to) {
    try {
      await this.#post(`/chat/sendPresence/${this.instance}`, {
        number: to,
        presence: "composing",
        delay: 5000,
      });
    } catch {
      /* indicador de digitação é opcional */
    }
  }

  async setWebhook(url) {
    return this.#post(`/webhook/set/${this.instance}`, {
      webhook: {
        enabled: true,
        url,
        byEvents: false,
        base64: false,
        events: ["MESSAGES_UPSERT"],
      },
    });
  }
}

function splitMessage(text, max) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
