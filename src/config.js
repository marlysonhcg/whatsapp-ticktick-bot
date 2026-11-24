// Lê e valida as variáveis de ambiente do bot.

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name} (veja o .env.example)`);
  }
  return value;
}

/**
 * Normaliza um número para só dígitos. Celulares brasileiros chegam do WhatsApp
 * às vezes sem o 9 (55 + DDD + 8 dígitos); aqui eles ganham o 9 de volta, para
 * que "5585987654321" e "558587654321" sejam tratados como o mesmo número.
 */
export function normalizeNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^55\d{2}[6-9]\d{7}$/.test(digits)) {
    return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

function optional(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function parseTime(value) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`DAILY_SUMMARY_TIME inválido: "${value}" (use HH:MM, ex.: 07:00)`);
  }
  return { hour: Number(m[1]), minute: Number(m[2]), label: `${m[1].padStart(2, "0")}:${m[2]}` };
}

function parseDays(value) {
  const days = value.split(",").map((d) => Number(d.trim()));
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    throw new Error(`DAILY_SUMMARY_DAYS inválido: "${value}" (use números de 0 a 6 separados por vírgula)`);
  }
  return new Set(days);
}

export function loadConfig() {
  const allowed = required("ALLOWED_NUMBERS")
    .split(",")
    .map(normalizeNumber)
    .filter(Boolean);
  if (allowed.length === 0) {
    throw new Error("ALLOWED_NUMBERS precisa ter pelo menos um número (só dígitos, com DDI e DDD).");
  }

  return {
    port: Number(optional("PORT", "3000")),
    webhookSecret: required("WEBHOOK_SECRET"),
    allowedNumbers: new Set(allowed),

    evolutionUrl: required("EVOLUTION_URL").replace(/\/+$/, ""),
    evolutionApiKey: required("EVOLUTION_API_KEY"),
    evolutionInstance: required("EVOLUTION_INSTANCE"),

    // claude-sonnet-5-5 (padrão) ou claude-haiku-5-5 (mais barato).
    anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
    anthropicEffort: optional("ANTHROPIC_EFFORT", "medium"),

    ticktickMcpUrl: optional("TICKTICK_MCP_URL", "https://mcp.ticktick.com"),
    ticktickToken: required("TICKTICK_TOKEN"),

    // Transcrição de áudio (opcional): sem a chave, áudios recebem um aviso.
    groqApiKey: optional("GROQ_API_KEY", ""),

    // Resumo automático (opcional): horário HH:MM e dias da semana (0=domingo ... 6=sábado).
    dailySummaryTime: parseTime(optional("DAILY_SUMMARY_TIME", "")),
    dailySummaryDays: parseDays(optional("DAILY_SUMMARY_DAYS", "0,1,2,3,4,5,6")),

    timezone: optional("TZ", "America/Sao_Paulo"),
    // Conversa recomeça do zero depois desse tempo sem mensagens (minutos).
    idleResetMinutes: Number(optional("IDLE_RESET_MINUTES", "30")),
    // ...ou depois de tantas trocas de mensagens, para não crescer sem limite.
    maxTurns: Number(optional("MAX_TURNS", "20")),
  };
}
