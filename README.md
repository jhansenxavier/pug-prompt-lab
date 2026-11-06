# 🐾 Pug Prompt Lab

Protótipo de **atendimento ao cliente por chat com IA** para o pet shop fictício *Bruce's Pug*, rodando em **modo debug** para comparar **5 variações estruturais de system prompt**, mais uma estrutura recomendada construída a partir dos resultados.

📄 **Relatório analítico com resultados, análise e recomendação: [RELATORIO.md](RELATORIO.md)**

Projeto desenvolvido para a disciplina **Engenharia de Inteligência Artificial**.

## Objetivo

Avaliar como a estrutura do system prompt muda a resposta do modelo para a **mesma pergunta** do cliente. Todos os prompts usam a mesma base de conhecimento da loja, então a diferença entre as respostas vem só da estrutura do prompt.

| Tipo | O que testa |
|---|---|
| **Simples** | Instrução mínima + dados da loja. É a linha de base. |
| **Role** | O modelo assume uma persona (Luna, atendente da loja) com tom de voz definido. |
| **Saída estruturada** | Formato fixo de resposta: Categoria, Resposta, Valores e Próximo passo. |
| **Few-shot** | Três exemplos de pergunta e resposta para o modelo imitar o estilo. |
| **Restrições e políticas** | Regras explícitas: escopo, não inventar preços, não diagnosticar, não dar descontos, limite de palavras, proteção contra *prompt injection*. |
| **Recomendado** | Híbrido criado a partir dos resultados: papel institucional, roteiro de decisão por tipo de mensagem, regras e exemplos de estilo. Veja o [relatório](RELATORIO.md). |

## Funcionalidades

- **Seletor de system prompt**: escolha o tipo antes de enviar a pergunta.
- **Comparar todos**: envia a mesma pergunta com todos os prompts e mostra as respostas em sequência.
- **Console de debug**:
  - **Chamada**: system prompt e mensagens enviadas, latência, provedor, modelo e tokens de entrada e saída.
  - **Editar prompt**: altere o texto de cada prompt na hora e restaure o padrão quando quiser.
  - **Métricas**: média de latência, palavras e tokens por tipo de prompt.
- **Perguntas de teste prontas**, incluindo casos difíceis: pedido de desconto, sintoma de saúde, assunto fora do escopo e tentativa de extrair o prompt.
- **Histórico opcional**: por padrão cada pergunta vai sozinha, para a comparação ser justa. Marque *Enviar histórico da conversa* para manter o contexto.

## Experimento automatizado

Além da interface, o projeto tem um experimento em linha de comando que roda **todas as perguntas do dataset com todos os prompts, várias vezes**, verifica cada resposta e gera as tabelas comparativas.

```bash
npm run experimento                  # 6 prompts × 27 perguntas × 3 repetições + avaliador
npm run experimento -- --reps=5      # mais repetições
npm run experimento -- --tipos=simples,recomendado --sem-juiz
npm run experimento:ca               # se a rede intercepta HTTPS (veja Problemas comuns)
```

- **Dataset:** 27 perguntas de clientes em 8 categorias (FAQ, cálculo, informação ausente, saúde, política comercial, fora do escopo, segurança e reclamação). Cada uma tem o comportamento esperado e verificações objetivas. As perguntas Q22–Q27 formam um conjunto de validação que não foi usado no desenho do prompt recomendado.
- **Verificações automáticas:** o que a resposta precisa conter e o que não pode conter, mais a detecção de preço ou telefone inventado.
- **Avaliador às cegas:** um LLM com temperatura 0 dá notas de 1 a 5 para clareza, completude, tom, segurança e fidelidade, sem saber qual prompt gerou a resposta.
- **Saída** em `experimento/resultados/`: `RESULTADOS.md` (tabelas), `RESPOSTAS.md` (todas as respostas) e `execucao-*.json` (dados brutos).

Para regerar as tabelas de uma execução salva, sem chamar a API: `node experimento/tabelas.mjs experimento/resultados/execucao-XXXX.json`.

## Provedores de IA suportados

O projeto **não depende de um provedor específico**. O backend tem um adaptador para cada API e converte tudo para o mesmo formato (`system` + `messages`).

| `AI_PROVIDER` | Serviço | Precisa de chave? |
|---|---|---|
| `anthropic` | Claude (Anthropic) | Sim |
| `openai` | GPT (OpenAI) | Sim |
| `gemini` | Gemini (Google AI Studio) | Sim |
| `openai-compatible` | Qualquer API no formato da OpenAI: Ollama, Groq, OpenRouter, LM Studio, DeepSeek… | Depende do serviço (Ollama local não precisa) |

## Requisitos

- [Node.js](https://nodejs.org/) **20.6 ou superior**
- Uma chave de API do provedor escolhido (veja abaixo)

O projeto não tem dependências externas, então não é preciso rodar `npm install`.

## Como rodar

### 1. Clone o repositório

```bash
git clone https://github.com/SEU-USUARIO/pug-prompt-lab.git
cd pug-prompt-lab
```

### 2. Configure a chave de API

Copie o arquivo de exemplo:

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

Abra o `.env` e preencha o provedor e a sua chave:

```env
AI_PROVIDER=anthropic
AI_API_KEY=sua-chave-aqui
```

Onde conseguir a chave:

- **Anthropic**: https://console.anthropic.com/settings/keys
- **OpenAI**: https://platform.openai.com/api-keys
- **Gemini**: https://aistudio.google.com/apikey
- **Groq**: https://console.groq.com/keys
- **OpenRouter**: https://openrouter.ai/keys

> ⚠️ **Nunca faça commit do arquivo `.env`.** Ele já está no `.gitignore`. A chave fica apenas no servidor e não é enviada ao navegador.

### 3. Inicie o servidor

```bash
npm start
```

Abra **http://localhost:3000** no navegador.

## Exemplos de configuração

**OpenAI**

```env
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4.1-mini
```

**Gemini**

```env
AI_PROVIDER=gemini
AI_API_KEY=AIza...
AI_MODEL=gemini-2.5-flash
```

**Ollama (modelo local e gratuito)**

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1
```

**Groq**

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.groq.com/openai/v1
AI_API_KEY=gsk_...
AI_MODEL=llama-3.3-70b-versatile
```

Os nomes de modelo mudam com frequência. Se aparecer erro de "model not found", confira o nome atual na documentação do provedor e ajuste `AI_MODEL`.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `AI_PROVIDER` | Sim | `anthropic`, `openai`, `gemini` ou `openai-compatible` |
| `AI_API_KEY` | Sim (exceto Ollama) | Chave de API do provedor |
| `AI_MODEL` | Não | Modelo a usar. Se ficar vazio, usa o padrão do provedor |
| `AI_BASE_URL` | Só para `openai-compatible` | URL base da API |
| `AI_MAX_TOKENS` | Não | Limite de tokens da resposta (padrão: 1024) |
| `PORT` | Não | Porta do servidor (padrão: 3000) |

## Estrutura do projeto

```
pug-prompt-lab/
├── public/
│   ├── index.html         # Interface: chat, seletor de prompts e console de debug
│   └── prompts.js         # Os system prompts e os dados da loja (usados pela página e pelo experimento)
├── lib/
│   └── ai.js              # Adaptadores de cada provedor de IA
├── experimento/
│   ├── perguntas.mjs      # Dataset: perguntas, comportamento esperado e verificações
│   ├── verificacoes.mjs   # Verificações automáticas (inclui detecção de preço/telefone inventado)
│   ├── rodar.mjs          # Executa o experimento e o avaliador às cegas
│   ├── tabelas.mjs        # Gera RESULTADOS.md e RESPOSTAS.md
│   └── resultados/        # Execuções salvas
├── server.js              # Servidor HTTP
├── RELATORIO.md           # Relatório analítico
├── .env.example
├── package.json
└── README.md
```

## Arquitetura

```
Navegador (index.html)
   │  POST /api/chat  { system, messages }
   ▼
server.js  ──►  adaptador do provedor  ──►  API de IA (Anthropic / OpenAI / Gemini / compatível)
   │
   ◄── { text, usage, provider, model, ms }
```

- Os **system prompts** e os **dados da loja** ficam em `public/prompts.js`, nas constantes `TYPES` e `INFO`. O marcador `{{INFO_LOJA}}` é trocado pelos dados da loja antes do envio.
- O system prompt vai pelo campo próprio de cada API: `system` na Anthropic, mensagem `role: "system"` na OpenAI e `systemInstruction` no Gemini.
- Para incluir outro provedor, basta adicionar uma função em `providers` no `lib/ai.js` que receba `{ system, messages }` e devolva `{ text, usage }`.

## Problemas comuns

**`fetch failed` / "Não consegui conectar em api..."**: o servidor não conseguiu acessar a API do provedor. O código entre colchetes mostra a causa.

Para testar a conexão fora do projeto, rode no terminal:

```bash
node -e "fetch('https://api.openai.com/v1/models').then(r=>console.log('OK, HTTP', r.status)).catch(e=>console.log('ERRO:', e.cause))"
```

- `OK, HTTP 401`: a conexão funciona (o 401 só indica que o teste foi feito sem chave).
- `SELF_SIGNED_CERT_IN_CHAIN` ou `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`: um antivírus ou a rede da faculdade/empresa está inspecionando o HTTPS. O navegador funciona porque confia nos certificados do sistema, mas o Node, por padrão, não. Soluções, da mais simples para a mais trabalhosa:
  1. Inicie com `npm run start:ca`, que faz o Node usar os certificados do sistema operacional. Requer Node 22.15+ (veja com `node -v`).
  2. Exporte o certificado raiz (Windows: `certmgr.msc` → *Autoridades de Certificação Raiz Confiáveis*; procure o nome do antivírus ou da empresa → *Exportar* em Base-64 `.cer`) e inicie com a variável `NODE_EXTRA_CA_CERTS` apontando para ele.
  3. Use outra rede, como o roteador do celular.
  
  Não use `NODE_TLS_REJECT_UNAUTHORIZED=0`: isso desliga a verificação de segurança e expõe a sua chave.
- `ENOTFOUND`, `ETIMEDOUT` ou `ECONNRESET`: sem internet, firewall ou proxy bloqueando. Se a rede exige proxy, use o Node 24+ e inicie com `NODE_USE_ENV_PROXY=1` e `HTTPS_PROXY=http://proxy:porta`.

**`HTTP 401`**: a chave está errada ou foi revogada.

**`HTTP 429`**: limite de uso atingido ou conta sem créditos. Na OpenAI, confira o saldo em *Billing*.

**`HTTP 404` / `model not found`**: o nome do modelo em `AI_MODEL` não existe para a sua conta.

Sempre que alterar o `.env`, reinicie o servidor (`Ctrl+C` e depois `npm start`).

## Observações

- Os dados da loja (endereço, telefones, preços) são **fictícios**.
- Este é um laboratório de testes: o navegador envia o system prompt ao servidor para permitir a edição ao vivo. Em produção, os prompts ficariam somente no backend.
