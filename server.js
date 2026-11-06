// Pug Prompt Lab — servidor local
// Serve a página (public/index.html) e repassa as mensagens para o provedor de IA
// configurado no .env. A chave de API fica só no servidor, nunca no navegador.
// Sem dependências: requer Node.js 20.6+ (fetch nativo e --env-file).

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PROVIDER, MODEL, configStatus, callAI } from "./lib/ai.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

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

    if (req.method === "GET" && req.url === "/prompts.js") {
      const js = await readFile(path.join(__dirname, "public", "prompts.js"));
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(js);
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
        const out = await callAI({ system, messages });
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
