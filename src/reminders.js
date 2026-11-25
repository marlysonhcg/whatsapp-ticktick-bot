// Lembretes pelo WhatsApp: X minutos antes de cada tarefa com horário do dia.
// Não usa o Claude (custo zero): lê as tarefas direto do TickTick e calcula os horários.

import { listOpenTasks } from "./ticktick-mcp.js";

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const REFRESH_MS = 5 * 60_000; // relê a lista de tarefas a cada 5 minutos
const TICK_MS = 30_000;

/** Partes da data/hora no fuso do usuário. */
function local(date, timezone) {
  const p = Object.fromEntries(
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
      .map((x) => [x.type, x.value]),
  );
  const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: weekdayIndex,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    hhmm: `${p.hour}:${p.minute}`,
  };
}

/** A regra de repetição cai neste dia da semana? (suporta DAILY e WEEKLY;BYDAY=...) */
function repeatsOn(repeatFlag, weekday) {
  const rule = String(repeatFlag).replace(/^RRULE:/, "");
  const parts = Object.fromEntries(rule.split(";").map((kv) => kv.split("=")));
  if (parts.FREQ === "DAILY") return true;
  if (parts.FREQ === "WEEKLY") {
    if (!parts.BYDAY) return null; // semanal sem dias definidos: não dá para saber
    return parts.BYDAY.split(",").some((d) => WEEKDAYS[d.replace(/^[+-]?\d+/, "")] === weekday);
  }
  return null; // outras regras (mensal etc.): usa só a data da ocorrência pendente
}

/**
 * Ocorrências de hoje (com horário) das tarefas em aberto.
 * Tarefas recorrentes que ficaram sem marcar em dias anteriores continuam valendo para hoje.
 */
export function occurrencesToday(tasks, timezone, now = new Date()) {
  const today = local(now, timezone);
  const list = [];
  for (const t of tasks) {
    if (!t.startDate || t.isAllDay) continue;
    const start = new Date(t.startDate.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    const end = t.dueDate ? new Date(t.dueDate.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")) : null;
    if (Number.isNaN(start.getTime())) continue;
    const s = local(start, timezone);
    const e = end && !Number.isNaN(end.getTime()) ? local(end, timezone) : null;

    let happensToday = s.day === today.day;
    if (!happensToday && t.repeatFlag && s.day < today.day) {
      happensToday = repeatsOn(t.repeatFlag, today.weekday) === true;
    }
    if (!happensToday) continue;

    list.push({
      id: t.id,
      title: t.title,
      content: t.content ?? "",
      startMinutes: s.minutes,
      label: e && e.hhmm !== s.hhmm ? `${s.hhmm}–${e.hhmm}` : s.hhmm,
      day: today.day,
    });
  }
  return list.sort((a, b) => a.startMinutes - b.startMinutes);
}

function formatReminder(occ, minutesBefore) {
  let text = `⏰ Em ${minutesBefore} min: *${occ.title}* (${occ.label})`;
  const extra = occ.content.replace(/Card[aá]pio:\s*\(preencher\)/i, "").replace(/Ligado ao hábito:.*$/im, "").trim();
  if (extra) text += `\n_${extra.slice(0, 200)}_`;
  return text;
}

/**
 * Inicia os lembretes.
 * @param {(text: string) => Promise<void>} send  envia uma mensagem para o usuário
 */
export function startReminders(config, send) {
  const minutesBefore = config.reminderMinutes;
  if (!minutesBefore) return null;

  let tasks = [];
  let fetchedAt = 0;
  const sent = new Set(); // "dia|id" já avisados

  const tick = async () => {
    try {
      if (Date.now() - fetchedAt > REFRESH_MS) {
        tasks = await listOpenTasks(config);
        fetchedAt = Date.now();
      }
      const now = local(new Date(), config.timezone);
      for (const occ of occurrencesToday(tasks, config.timezone)) {
        const key = `${occ.day}|${occ.id}`;
        const diff = occ.startMinutes - now.minutes;
        // Avisa quando faltam X minutos (com folga de 1 min caso o bot tenha atrasado a checagem).
        if (diff <= minutesBefore && diff >= minutesBefore - 1 && !sent.has(key)) {
          sent.add(key);
          await send(formatReminder(occ, minutesBefore));
        }
      }
      if (sent.size > 500) sent.clear();
    } catch (error) {
      console.error("[lembretes] falhou:", error?.message ?? error);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  tick();
  return timer;
}
