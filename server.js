// Pug Prompt Lab — servidor local
// Serve a página (public/index.html) e repassa as mensagens para o provedor de IA
// configurado no .env. A chave de API fica só no servidor, nunca no navegador.
// Sem dependências: requer Node.js 20.6+ (fetch nativo e --env-file).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const API_KEY = process.env.AI_API_KEY || "";
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 1024;

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "llama3.1",
};
const MODEL = process.env.AI_MODEL || DEFAULT_MODELS[PROVIDER];
const BASE_URL = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Adaptadores: cada provedor recebe { system, messages } no mesmo formato
// e devolve { text, usage: { input, output } }.
// messages = [{ role: "user" | "assistant", content: string }, ...]
// ---------------------------------------------------------------------------
const providers = {
  async anthropic({ system, messages }) {
    const data = await post("https://api.anthropic.com/v1/messages", {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    }, { model: MODEL, max_tokens: MAX_TOKENS, system, messages });
    return {
      text: (data.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
      usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
    };
  },

  async openai({ system, messages }) {
    return openAIStyle(BASE_URL || "https://api.openai.com/v1", { system, messages });
  },

  // Qualquer API no formato da OpenAI: Ollama, Groq, OpenRouter, LM Studio, DeepSeek...
  async "openai-compatible"({ system, messages }) {
    if (!BASE_URL) throw new Error("Defina AI_BASE_URL no .env (ex.: http://localhost:11434/v1 para o Ollama).");
    return openAIStyle(BASE_URL, { system, messages });
  },

  async gemini({ system, messages }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const data = await post(url, { "x-goog-api-key": API_KEY }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    });
    const parts = data.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.map(p => p.text || "").join(""),
      usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount },
    };
  },
};

async function openAIStyle(baseUrl, { system, messages }) {
  const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
  const data = await post(`${baseUrl}/chat/completions`, headers, {
    model: MODEL,
    messages: [{ role: "system", content: system }, ...messages],
  });
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
  };
}

// Dicas para os erros de rede mais comuns (o Node só diz "fetch failed";
// a causa real fica em error.cause).
const NETWORK_HINTS = {
  ENOTFOUND: "não foi possível resolver o endereço (DNS). Verifique a internet ou o AI_BASE_URL.",
  EAI_AGAIN: "falha temporária de DNS. Verifique a internet.",
  ECONNREFUSED: "conexão recusada. Se for local (Ollama), confira se o serviço está rodando.",
  ECONNRESET: "a conexão foi encerrada no meio. Pode ser firewall, antivírus ou proxy da rede.",
  ETIMEDOUT: "tempo esgotado. A rede pode estar bloqueando o acesso à API.",
  UND_ERR_CONNECT_TIMEOUT: "tempo de conexão esgotado. A rede pode estar bloqueando o acesso à API.",
  SELF_SIGNED_CERT_IN_CHAIN: "certificado interceptado por proxy/antivírus. Veja a seção 'Problemas comuns' do README.",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "certificado interceptado por proxy/antivírus. Veja a seção 'Problemas comuns' do README.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "certificado interceptado por proxy/antivírus. Veja a seção 'Problemas comuns' do README.",
  CERT_HAS_EXPIRED: "certificado inválido ou relógio do computador errado.",
};

async function post(url, headers, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    const cause = e.cause || {};
    const code = cause.code || cause.name || e.name;
    const hint = NETWORK_HINTS[code] || cause.message || e.message;
    throw new Error(`Não consegui conectar em ${new URL(url).host} [${code || "erro de rede"}]: ${hint}`);
  }
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || raw.slice(0, 300) || res.statusText;
    throw new Error(`${PROVIDER} respondeu HTTP ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Validação da configuração
// ---------------------------------------------------------------------------
function configStatus() {
  if (!providers[PROVIDER]) {
    return { ready: false, message: `AI_PROVIDER inválido: "${PROVIDER}". Use: ${Object.keys(providers).join(", ")}.` };
  }
  if (!API_KEY && PROVIDER !== "openai-compatible") {
    return { ready: false, message: "Falta a chave de API. Copie .env.example para .env e preencha AI_API_KEY." };
  }
  return { ready: true, message: "ok" };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit) { reject(new Error("Requisição muito grande.")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validMessages(m) {
  return Array.isArray(m) && m.length > 0 && m.every(x =>
    x && (x.role === "user" || x.role === "assistant") && typeof x.content === "string" && x.content.trim());
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      const html = await readFile(path.join(__dirname, "public", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    if (req.method === "GET" && req.url === "/api/config") {
      return sendJSON(res, 200, { provider: PROVIDER, model: MODEL, ...configStatus() });
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      const status = configStatus();
      if (!status.ready) return sendJSON(res, 500, { error: status.message });

      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return sendJSON(res, 400, { error: "JSON inválido." }); }
      const { system, messages } = body || {};
      if (typeof system !== "string" || !system.trim()) return sendJSON(res, 400, { error: "Campo 'system' ausente." });
      if (!validMessages(messages)) return sendJSON(res, 400, { error: "Campo 'messages' inválido." });

      const t0 = Date.now();
      try {
        const out = await providers[PROVIDER]({ system, messages });
        return sendJSON(res, 200, { ...out, provider: PROVIDER, model: MODEL, ms: Date.now() - t0 });
      } catch (e) {
        console.error("[erro]", e.message);
        return sendJSON(res, 502, { error: e.message });
      }
    }

    sendJSON(res, 404, { error: "Não encontrado." });
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: "Erro interno do servidor." });
  }
});

server.listen(PORT, () => {
  const s = configStatus();
  console.log(`\n🐾 Pug Prompt Lab em http://localhost:${PORT}`);
  console.log(`   Provedor: ${PROVIDER} · Modelo: ${MODEL}`);
  if (!s.ready) console.warn(`   ⚠️  ${s.message}`);
});
