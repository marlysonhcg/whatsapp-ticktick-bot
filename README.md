# Bot WhatsApp + TickTick (Evolution API + Claude)

Você manda uma mensagem no WhatsApp para o número do bot ("o que tenho pra hoje?",
"cria uma tarefa pra amanhã às 9h: ligar pro dentista") e ele responde consultando
ou alterando o seu TickTick.

```
Seu WhatsApp ──► chip do bot (Evolution) ──► webhook ──► este bot ──► Claude ──► TickTick (MCP oficial)
             ◄──────────────────────── resposta ◄─────────────────────────┘
```

## O que você precisa

- A Evolution API v2 rodando no seu VPS, com uma instância conectada ao **chip secundário**.
- Docker no VPS (o mesmo onde está a Evolution serve).
- Uma chave da API da Anthropic: https://console.anthropic.com → API Keys
  (cobrança por uso, separada da assinatura do Claude).
- Node.js 20+ no **seu computador**, só para fazer o login no TickTick uma vez.

## Passo 1: login no TickTick (no seu computador)

Na pasta do projeto:

```
npm install
cp .env.example .env        # no Windows: copy .env.example .env
npm run ticktick-login
```

O navegador abre na página do TickTick. Entre na sua conta e autorize. O token é
gravado sozinho no `.env`, na linha `TICKTICK_TOKEN`.

## Passo 2: preencher o `.env`

Abra o `.env` e preencha:

| Variável | O que colocar |
|---|---|
| `ALLOWED_NUMBERS` | **Seu** número pessoal (quem manda mensagem pro bot), ex.: `5511999999999` |
| `WEBHOOK_SECRET` | Um texto aleatório longo (comando para gerar está no arquivo) |
| `EVOLUTION_URL` | Endereço da sua Evolution, ex.: `http://IP_DO_VPS:8080` |
| `EVOLUTION_API_KEY` | A chave global da Evolution (`AUTHENTICATION_API_KEY` do servidor dela) |
| `EVOLUTION_INSTANCE` | Nome da instância conectada ao chip do bot |
| `ANTHROPIC_API_KEY` | Sua chave da Anthropic |

Depois confira se está tudo certo:

```
npm run check
```

## Passo 3: subir no VPS

### Pelo Easypanel (recomendado se você já usa)

1. No projeto da Evolution, clique em **+ Service → App** e dê o nome `bot`.
2. Em **Source**, escolha **GitHub** (ou Git) e aponte para este repositório, branch `main`.
3. Em **Build**, escolha **Dockerfile**.
4. Em **Environment**, cole o conteúdo do seu `.env`.
5. Em **Domains**, crie um domínio apontando para a porta **3000**.
6. Clique em **Deploy**. Em seguida, ligue o webhook (passo 4) usando esse domínio.

### Pelo Docker Compose

Copie a pasta do projeto (com o `.env`, sem a `node_modules`) para o VPS, por exemplo
com `scp -r whatsapp-ticktick-bot usuario@IP_DO_VPS:~/`. Lá dentro:

```
docker compose up -d --build
docker compose logs -f
```

## Passo 4: ligar o webhook da Evolution ao bot

Ainda no VPS, dentro da pasta:

```
docker compose exec bot node scripts/setup-webhook.js http://IP_DO_VPS:3000
```

Se você colocou o bot na mesma rede Docker da Evolution (veja o comentário no
`docker-compose.yml`), use `http://bot:3000` no lugar e pode remover a porta exposta.

Também dá para configurar pelo painel da Evolution: em *Webhook*, URL
`http://IP_DO_VPS:3000/webhook/SEU_WEBHOOK_SECRET`, evento `MESSAGES_UPSERT`,
"Webhook by events" desligado.

## Passo 5: testar

Do seu WhatsApp pessoal, mande para o número do bot:

- `o que tenho pra hoje?`
- `cria uma tarefa "comprar remédio" pra amanhã às 10h no projeto Saúde`
- `conclui a tarefa comprar remédio`
- `/novo` → começa uma conversa nova (o bot esquece o contexto anterior)

## Funções extras

### Mensagens de voz
Com `GROQ_API_KEY` preenchida (crie em https://console.groq.com/keys, tem plano
gratuito), o bot transcreve áudios e responde como se fosse texto. A resposta começa
com 🎤 e o que ele entendeu, para você conferir. Sem a chave, ele avisa que só lê texto.

### Resumo da manhã
Com `DAILY_SUMMARY_TIME=07:00`, todo dia nesse horário o bot manda: tarefas de hoje,
atrasadas (quantidade e as 3 mais importantes) e hábitos do dia. Você pode responder
em cima do resumo ("reagenda as atrasadas pra hoje"). Para só dias úteis, use
`DAILY_SUMMARY_DAYS=1,2,3,4,5`. Se o bot for reimplantado dentro de 1 hora depois do
horário, o resumo pode chegar de novo.

### Excluir tarefas (com confirmação)
Peça "apaga a tarefa X". O bot mostra exatamente o que vai excluir e só apaga se você
responder **SIM** (ou "confirmo", "pode apagar") em até 10 minutos. Qualquer outra
resposta cancela. Quem executa a exclusão é o próprio bot, nunca o Claude, e só depois
da sua confirmação. Projetos, listas, tags e comentários continuam sem poder ser
apagados por aqui.

## Como funciona e limites

- **Só responde aos números em `ALLOWED_NUMBERS`.** Mensagens de outros números e de
  grupos são ignoradas (aparecem no log como `[ignorado]`).
- Antes de alterar várias tarefas de uma vez, o bot pede confirmação.
- Imagens e figurinhas são ignoradas (a legenda de uma foto é lida como texto).
- A memória da conversa fica na RAM e recomeça após 30 minutos parada, após 20 trocas
  ou quando o bot reinicia.
- Modelo: `claude-sonnet-5-5` com esforço `medium`. Se o modelo recusar um pedido por
  segurança, a API tenta automaticamente um modelo alternativo. Para gastar menos,
  troque `ANTHROPIC_MODEL` para `claude-haiku-5-5` (cerca de 1/20 do custo) e rode
  `docker compose up -d`.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Bot não responde e o log mostra `[ignorado]` | O número em `ALLOWED_NUMBERS` não bate com o seu (precisa de 55 + DDD, só dígitos) |
| Bot não responde e não aparece nada no log | Webhook não chega: refaça o passo 4 e verifique se a porta 3000 está liberada no firewall |
| "Não consegui acessar o TickTick" | O token expirou: rode `npm run ticktick-login` no computador e atualize `TICKTICK_TOKEN` no VPS, depois `docker compose up -d` |
| "chave da API da Anthropic é inválida" | Confira `ANTHROPIC_API_KEY` e se há crédito na conta |

## Aviso sobre o número

A Evolution conecta pelo protocolo do WhatsApp Web (não oficial). Isso pode levar a
bloqueio do número, por isso use um chip secundário dedicado ao bot.
