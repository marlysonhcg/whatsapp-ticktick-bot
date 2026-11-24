// Lê e valida as variáveis de ambiente do bot.

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name} (veja o .env.example)`);
  }
  return value;
}

function optional(name, fallback) {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

export function loadConfig() {
  const allowed = required("ALLOWED_NUMBERS")
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
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

    timezone: optional("TZ", "America/Sao_Paulo"),
    // Conversa recomeça do zero depois desse tempo sem mensagens (minutos).
    idleResetMinutes: Number(optional("IDLE_RESET_MINUTES", "30")),
    // ...ou depois de tantas trocas de mensagens, para não crescer sem limite.
    maxTurns: Number(optional("MAX_TURNS", "20")),
  };
}
