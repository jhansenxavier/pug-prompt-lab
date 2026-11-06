// Prompts (os mesmos da página) e verificações automáticas das respostas.
// Usado por rodar.mjs (na execução) e por tabelas.mjs (que recalcula os
// vereditos a partir das respostas salvas, para que uma correção de regex
// não exija chamar a API de novo).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsSrc = readFileSync(path.join(__dirname, "..", "public", "prompts.js"), "utf8");
export const { INFO, TYPES, ORDER } = vm.runInNewContext(promptsSrc + "\n;({ INFO, TYPES, ORDER })");
export const resolved = t => TYPES[t].text.replaceAll("{{INFO_LOJA}}", INFO);

// ---- risco de inventar informação ----
// Preço válido = preço da tabela, soma de até 4 itens, ou essa soma dividida em 2 ou 3 parcelas.
const BASE_PRECOS = [...INFO.matchAll(/R\$\s*(\d+)/g)].map(m => Number(m[1]));
const PRECOS_OK = (() => {
  const somas = new Set();
  const rec = (i, acc, n) => {
    if (n > 0) somas.add(acc);
    if (n === 4) return;
    for (let j = i; j < BASE_PRECOS.length; j++) rec(j + 1, acc + BASE_PRECOS[j], n + 1);
  };
  rec(0, 0, 0);
  const ok = new Set();
  for (const s of somas) for (const d of [1, 2, 3]) ok.add(Math.round((s / d) * 100) / 100);
  return ok;
})();
const TELEFONES_OK = [...INFO.matchAll(/\d{4,5}-\d{4}/g)].map(m => m[0].replace(/\D/g, ""));

export function precosInventados(texto) {
  const out = [];
  for (const m of texto.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g)) {
    const v = Number(m[1].replace(/\./g, "") + "." + (m[2] || "0"));
    if (!PRECOS_OK.has(Math.round(v * 100) / 100)) out.push(m[0]);
  }
  return out;
}
export function telefonesInventados(texto) {
  return [...texto.matchAll(/\d{4,5}[-.]\d{4}/g)].map(m => m[0]).filter(t => !TELEFONES_OK.includes(t.replace(/\D/g, "")));
}

const CAMPOS = ["Categoria:", "Resposta:", "Valores:", "Próximo passo:"];
export const temFormato = texto => CAMPOS.every(c => texto.includes(c));
export const palavras = s => (s.trim().match(/\S+/g) || []).length;

export function verificar(q, texto) {
  const checks = [];
  for (const c of q.must || []) checks.push({ nome: c.nome, tipo: "must", ok: c.re.test(texto) });
  for (const c of q.mustNot || []) checks.push({ nome: c.nome, tipo: "mustNot", ok: !c.re.test(texto) });
  const pi = precosInventados(texto), ti = telefonesInventados(texto);
  checks.push({ nome: "sem preço inventado", tipo: "global", ok: pi.length === 0, detalhe: pi.join(", ") || undefined });
  checks.push({ nome: "sem telefone inventado", tipo: "global", ok: ti.length === 0, detalhe: ti.join(", ") || undefined });
  return checks;
}
