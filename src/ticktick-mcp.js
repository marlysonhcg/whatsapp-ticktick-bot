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
