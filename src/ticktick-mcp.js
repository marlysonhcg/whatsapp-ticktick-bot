// Acesso direto ao servidor MCP do TickTick, usado só para executar exclusões
// já confirmadas pelo usuário (o Claude nunca apaga nada sozinho).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function withClient(config, fn) {
  const transport = new StreamableHTTPClientTransport(new URL(config.ticktickMcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${config.ticktickToken}` } },
  });
  const client = new Client({ name: "whatsapp-ticktick-bot", version: "1.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Lista os nomes das ferramentas do servidor (usado na verificação). */
export function listTools(config) {
  return withClient(config, async (client) => (await client.listTools()).tools.map((t) => t.name));
}

/**
 * Lista as tarefas em aberto com data entre 13 dias atrás e o fim de hoje
 * (o TickTick aceita no máximo 14 dias por consulta). Recorrentes vêm com a ocorrência pendente.
 */
export function listOpenTasks(config) {
  return withClient(config, async (client) => {
    const end = new Date(Date.now() + 24 * 3600_000);
    const start = new Date(Date.now() - 13 * 24 * 3600_000);
    const result = await client.callTool({
      name: "list_undone_tasks_by_date",
      arguments: {
        search: { startDate: start.toISOString(), endDate: end.toISOString() },
        client_timezone: config.timezone,
      },
    });
    if (result.isError) throw new Error("O TickTick recusou a consulta de tarefas.");
    if (Array.isArray(result.structuredContent?.result)) return result.structuredContent.result;
    // Sem structuredContent, o servidor manda um bloco de texto por tarefa (ou um JSON com "result").
    const tasks = [];
    for (const block of result.content ?? []) {
      if (block.type !== "text") continue;
      try {
        const parsed = JSON.parse(block.text);
        if (Array.isArray(parsed?.result)) tasks.push(...parsed.result);
        else if (Array.isArray(parsed)) tasks.push(...parsed);
        else if (parsed?.id) tasks.push(parsed);
      } catch {
        /* bloco que não é JSON: ignora */
      }
    }
    return tasks;
  });
}

/**
 * Exclui as tarefas, uma por uma.
 * @param {{project_id: string, task_id: string, titulo: string}[]} tasks
 * @returns {Promise<{ok: string[], failed: string[]}>} títulos excluídos e títulos que falharam
 */
export function deleteTasks(config, tasks) {
  return withClient(config, async (client) => {
    const ok = [];
    const failed = [];
    for (const t of tasks) {
      try {
        const result = await client.callTool({
          name: "delete_task",
          arguments: { project_id: t.project_id, task_id: t.task_id },
        });
        if (result.isError) failed.push(t.titulo);
        else ok.push(t.titulo);
      } catch {
        failed.push(t.titulo);
      }
    }
    return { ok, failed };
  });
}
