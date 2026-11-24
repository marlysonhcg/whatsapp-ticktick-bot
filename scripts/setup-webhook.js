// Aponta o webhook da instância da Evolution para o bot.
// Uso:  npm run setup-webhook -- https://ENDERECO_DO_BOT
//   ex: npm run setup-webhook -- http://bot:3000          (mesma rede Docker da Evolution)
//       npm run setup-webhook -- http://203.0.113.10:3000  (IP do VPS)

import { loadConfig } from "../src/config.js";
import { EvolutionClient } from "../src/evolution.js";

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base) {
  console.error("Informe o endereço do bot. Ex.: npm run setup-webhook -- http://bot:3000");
  process.exit(1);
}

const config = loadConfig();
const evolution = new EvolutionClient(config);
const url = `${base}/webhook/${config.webhookSecret}`;

try {
  await evolution.setWebhook(url);
  console.log(`Webhook configurado na instância "${config.evolutionInstance}":`);
  console.log(`${base}/webhook/<WEBHOOK_SECRET>  (evento MESSAGES_UPSERT)`);
} catch (error) {
  console.error("Não consegui configurar o webhook:", error.message);
  process.exit(1);
}
