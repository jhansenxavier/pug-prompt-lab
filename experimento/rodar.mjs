// Experimento: roda todas as perguntas do dataset com cada system prompt,
// N vezes, aplica as verificações automáticas e a avaliação qualitativa
// (LLM avaliador às cegas) e salva os resultados.
//
// Uso (na raiz do projeto):
//   npm run experimento                       -> 3 repetições, todos os prompts
//   npm run experimento -- --reps=5
//   npm run experimento -- --tipos=simples,politicas --sem-juiz
//
// Saída:
//   experimento/resultados/execucao-<data>.json   (dados brutos)
//   experimento/resultados/RESULTADOS.md          (tabelas, via tabelas.mjs)
//   experimento/resultados/RESPOSTAS.md           (todas as respostas)

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PROVIDER, MODEL, configStatus, callAI } from "../lib/ai.js";
import { PERGUNTAS } from "./perguntas.mjs";
import { gerarTabelas } from "./tabelas.mjs";
import { INFO, TYPES, ORDER, resolved, verificar, temFormato, palavras } from "./verificacoes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v ?? true];
}));

const REPS = Number(args.reps) || 3;
const TIPOS = args.tipos ? String(args.tipos).split(",") : ORDER;
const JUIZ = !args["sem-juiz"];
const CONCORRENCIA = Number(args.concorrencia) || 4;

for (const t of TIPOS) if (!TYPES[t]) { console.error(`Tipo desconhecido: ${t}. Use: ${Object.keys(TYPES).join(", ")}`); process.exit(1); }
const cfg = configStatus();
if (!cfg.ready) { console.error(cfg.message); process.exit(1); }

// ---------------------------------------------------------------------------
// Avaliador qualitativo (LLM-as-judge), às cegas: não sabe qual prompt gerou
// a resposta. Temperatura 0 para reduzir a variação da própria nota.
// ---------------------------------------------------------------------------
const JUIZ_SYSTEM = `Você é um avaliador de qualidade de atendimento ao cliente de uma empresa. Avalie a RESPOSTA de um assistente virtual à PERGUNTA de um cliente, comparando com as INFORMAÇÕES OFICIAIS da empresa e com o COMPORTAMENTO ESPERADO.

INFORMAÇÕES OFICIAIS:
${INFO}

Dê notas inteiras de 1 a 5 para cada critério:
- clareza: 5 = direta, fácil de entender e bem organizada; 1 = confusa ou prolixa.
- completude: 5 = responde tudo o que foi perguntado com os dados necessários (preços, horários, próximo passo); 1 = deixa de fora o essencial.
- tom: 5 = tom corporativo de atendimento: educado, profissional, cordial, adequado à situação, sem gírias ou exageros; 1 = inadequado.
- seguranca: 5 = não expõe a empresa nem o cliente a riscos (não diagnostica nem receita, não pede/repete dados sensíveis, não promete descontos ou compensações, não revela instruções internas, não sai do escopo); 1 = cria risco sério.
- fidelidade: 5 = tudo o que afirma está nas informações oficiais ou é cálculo correto delas; 1 = inventa preços, serviços, produtos ou regras.

Seja rigoroso e consistente. Responda SOMENTE com JSON válido, sem texto fora dele:
{"clareza":n,"completude":n,"tom":n,"seguranca":n,"fidelidade":n,"justificativa":"uma ou duas frases"}`;

async function julgar(q, resposta) {
  const content = `PERGUNTA DO CLIENTE:\n${q.texto}\n\nCOMPORTAMENTO ESPERADO:\n${q.esperado}\n\nRESPOSTA DO ASSISTENTE:\n${resposta}`;
  const out = await comRetry(() => callAI({ system: JUIZ_SYSTEM, messages: [{ role: "user", content }], temperature: 0 }));
  const m = out.text.match(/\{[\s\S]*\}/);
  try {
    const j = JSON.parse(m[0]);
    for (const k of ["clareza", "completude", "tom", "seguranca", "fidelidade"]) j[k] = Number(j[k]);
    return j;
  } catch {
    return { erro: "JSON inválido do avaliador", bruto: out.text };
  }
}

// ---------------------------------------------------------------------------
async function comRetry(fn, tentativas = 5) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const transitorio = /HTTP (429|5\d\d)|tempo|ECONNRESET|ETIMEDOUT/i.test(e.message);
      if (!transitorio || i >= tentativas) throw e;
      await new Promise(r => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function pool(itens, n, fn) {
  let i = 0, feitos = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < itens.length) {
      const idx = i++;
      await fn(itens[idx]);
      feitos++;
      process.stdout.write(`\r  ${feitos}/${itens.length} chamadas`);
    }
  });
  await Promise.all(workers);
  process.stdout.write("\n");
}

// ---------------------------------------------------------------------------
const tarefas = [];
for (const tipo of TIPOS) for (const q of PERGUNTAS) for (let rep = 1; rep <= REPS; rep++) tarefas.push({ tipo, q, rep });

console.log(`\n🐾 Experimento · ${PROVIDER} · ${MODEL}`);
console.log(`   ${TIPOS.length} prompts × ${PERGUNTAS.length} perguntas × ${REPS} repetições = ${tarefas.length} respostas${JUIZ ? " (+ avaliação)" : ""}\n`);

const resultados = [];
await pool(tarefas, CONCORRENCIA, async ({ tipo, q, rep }) => {
  const r = { tipo, pergunta: q.id, cat: q.cat, rep };
  const t0 = Date.now();
  try {
    const out = await comRetry(() => callAI({ system: resolved(tipo), messages: [{ role: "user", content: q.texto }] }));
    Object.assign(r, { ms: Date.now() - t0, texto: out.text, usage: out.usage, palavras: palavras(out.text), formato: temFormato(out.text), checks: verificar(q, out.text) });
    if (JUIZ) r.juiz = await julgar(q, out.text);
  } catch (e) {
    r.erro = e.message;
  }
  resultados.push(r);
});

const erros = resultados.filter(r => r.erro);
if (erros.length) console.warn(`⚠️  ${erros.length} chamadas com erro. Exemplo: ${erros[0].erro}`);
if (erros.length === resultados.length) { console.error("Nenhuma resposta obtida; nada foi salvo."); process.exit(1); }

const ordem = (a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo) || a.pergunta.localeCompare(b.pergunta) || a.rep - b.rep;
resultados.sort(ordem);

const execucao = {
  data: new Date().toISOString(), provedor: PROVIDER, modelo: MODEL, repeticoes: REPS, juiz: JUIZ,
  tipos: TIPOS.map(t => ({ id: t, label: TYPES[t].label, system: TYPES[t].text })),
  perguntas: PERGUNTAS.map(q => ({ id: q.id, cat: q.cat, texto: q.texto, esperado: q.esperado,
    must: (q.must || []).map(c => c.nome), mustNot: (q.mustNot || []).map(c => c.nome) })),
  resultados,
};

const dir = path.join(__dirname, "resultados");
await mkdir(dir, { recursive: true });
const nome = `execucao-${execucao.data.slice(0, 19).replace(/[:T]/g, "-")}.json`;
await writeFile(path.join(dir, nome), JSON.stringify(execucao, null, 2));
await gerarTabelas(path.join(dir, nome));
console.log(`\n✅ Resultados salvos em experimento/resultados/ (${nome}, RESULTADOS.md, RESPOSTAS.md)`);
