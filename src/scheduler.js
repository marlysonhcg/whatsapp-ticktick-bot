// Resumo automático diário: no horário configurado, manda a agenda do dia pelo WhatsApp.

const SUMMARY_PROMPT = `[Mensagem automática do bot, não foi o usuário que escreveu]
Monte o meu resumo da manhã de hoje, consultando o TickTick:
1. Tarefas de hoje, em ordem de horário (as sem horário no fim), com a prioridade quando for alta.
2. Tarefas atrasadas (só a quantidade e as 3 mais importantes, se houver).
3. Hábitos para fazer hoje, se eu tiver hábitos cadastrados.
Comece com um "Bom dia!" curto e termine perguntando se quero ajustar alguma coisa. Seja breve.`;

// Se o bot reiniciar depois do horário, ainda envia o resumo dentro desta janela.
const WINDOW_MINUTES = 60;

/** Data (AAAA-MM-DD), dia da semana (0-6) e minutos desde 00:00 no fuso do usuário. */
export function localNow(timezone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: weekdays[parts.weekday],
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Decide se o resumo deve sair agora. */
export function isDue(config, lastSentDay, now) {
  const target = config.dailySummaryTime;
  if (!target || lastSentDay === now.day || !config.dailySummaryDays.has(now.weekday)) return false;
  const start = target.hour * 60 + target.minute;
  return now.minutes >= start && now.minutes < start + WINDOW_MINUTES;
}

/**
 * Inicia o agendador.
 * @param {(userKey: string, prompt: string) => Promise<void>} sendSummary
 */
export function startDailySummary(config, sendSummary) {
  if (!config.dailySummaryTime) return null;
  let lastSentDay = null;
  let running = false;

  const tick = async () => {
    const now = localNow(config.timezone);
    if (running || !isDue(config, lastSentDay, now)) return;
    running = true;
    lastSentDay = now.day; // marca antes, para nunca mandar duas vezes no mesmo dia
    try {
      for (const userKey of config.allowedNumbers) {
        await sendSummary(userKey, SUMMARY_PROMPT).catch((error) =>
          console.error("[resumo] falhou para um número:", error?.message ?? error),
        );
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, 30_000);
  tick();
  return timer;
}
