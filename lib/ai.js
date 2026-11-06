// Adaptadores de provedores de IA. Usado por server.js e por experimento/rodar.mjs.
// Lê a configuração de process.env (carregada com node --env-file=.env).

export const PROVIDER = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
const API_KEY = process.env.AI_API_KEY || "";
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS) || 1024;

const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "llama3.1",
};
export const MODEL = process.env.AI_MODEL || DEFAULT_MODELS[PROVIDER];
const BASE_URL = (process.env.AI_BASE_URL || "").replace(/\/+$/, "");

// ---------------------------------------------------------------------------
// Adaptadores: cada provedor recebe { system, messages } no mesmo formato
// e devolve { text, usage: { input, output } }.
// messages = [{ role: "user" | "assistant", content: string }, ...]
// ---------------------------------------------------------------------------
const providers = {
  async anthropic({ system, messages, temperature }) {
    const data = await post("https://api.anthropic.com/v1/messages", {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    }, { model: MODEL, max_tokens: MAX_TOKENS, system, messages, ...(temperature != null && { temperature }) });
    return {
      text: (data.content || []).filter(b => b.type === "text").map(b => b.text).join(""),
      usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
    };
  },

  async openai(req) {
    return openAIStyle(BASE_URL || "https://api.openai.com/v1", req);
  },

  // Qualquer API no formato da OpenAI: Ollama, Groq, OpenRouter, LM Studio, DeepSeek...
  async "openai-compatible"(req) {
    if (!BASE_URL) throw new Error("Defina AI_BASE_URL no .env (ex.: http://localhost:11434/v1 para o Ollama).");
    return openAIStyle(BASE_URL, req);
  },

  async gemini({ system, messages, temperature }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const data = await post(url, { "x-goog-api-key": API_KEY }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: MAX_TOKENS, ...(temperature != null && { temperature }) },
    });
    const parts = data.candidates?.[0]?.content?.parts || [];
    return {
      text: parts.map(p => p.text || "").join(""),
      usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount },
    };
  },
};

async function openAIStyle(baseUrl, { system, messages, temperature }) {
  const headers = API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {};
  const data = await post(`${baseUrl}/chat/completions`, headers, {
    model: MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    ...(temperature != null && { temperature }),
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
export function configStatus() {
  if (!providers[PROVIDER]) {
    return { ready: false, message: `AI_PROVIDER inválido: "${PROVIDER}". Use: ${Object.keys(providers).join(", ")}.` };
  }
  if (!API_KEY && PROVIDER !== "openai-compatible") {
    return { ready: false, message: "Falta a chave de API. Copie .env.example para .env e preencha AI_API_KEY." };
  }
  return { ready: true, message: "ok" };
}

// Chamada única usada pelo servidor e pelo experimento.
// temperature é opcional; sem ela, vale o padrão do provedor.
export async function callAI({ system, messages, temperature }) {
  return providers[PROVIDER]({ system, messages, temperature });
}
