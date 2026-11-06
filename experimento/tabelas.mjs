// Gera as tabelas comparativas (RESULTADOS.md) e o anexo com todas as
// respostas (RESPOSTAS.md) a partir de um execucao-*.json.
//
// Uso direto: node experimento/tabelas.mjs experimento/resultados/execucao-XXXX.json

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIAS, PERGUNTAS } from "./perguntas.mjs";
import { verificar, temFormato } from "./verificacoes.mjs";

const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
const media = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const f1 = x => (Number.isFinite(x) ? x.toFixed(1) : "–");
const f0 = x => (Number.isFinite(x) ? Math.round(x).toString() : "–");
const dp = xs => { const m = media(xs); return Math.sqrt(media(xs.map(x => (x - m) ** 2))); };
const linha = cols => "| " + cols.join(" | ") + " |";
const cab = cols => linha(cols) + "\n" + linha(cols.map((_, i) => (i ? "---:" : "---")));
const md1 = s => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");

export async function gerarTabelas(arquivo) {
  const ex = JSON.parse(await readFile(arquivo, "utf8"));
  // Recalcula os vereditos com as verificações atuais (as respostas salvas não mudam).
  const porId = Object.fromEntries(PERGUNTAS.map(q => [q.id, q]));
  for (const r of ex.resultados) if (!r.erro && porId[r.pergunta]) { r.checks = verificar(porId[r.pergunta], r.texto); r.formato = temFormato(r.texto); }
  for (const q of ex.perguntas) if (porId[q.id]) { q.must = (porId[q.id].must || []).map(c => c.nome); q.mustNot = (porId[q.id].mustNot || []).map(c => c.nome); }
  const ok = ex.resultados.filter(r => !r.erro);
  const tipos = ex.tipos;
  const L = Object.fromEntries(tipos.map(t => [t.id, t.label]));
  const de = t => ok.filter(r => r.tipo === t);
  const notas = ["clareza", "completude", "tom", "seguranca", "fidelidade"];
  // Avaliação válida = as 5 notas presentes e entre 1 e 5 (o avaliador às vezes erra o nome de um campo).
  const juizValido = r => r.juiz && !r.juiz.erro && notas.every(n => Number.isInteger(r.juiz[n]) && r.juiz[n] >= 1 && r.juiz[n] <= 5);
  const comJuiz = rs => rs.filter(juizValido);

  const regras = rs => { const c = rs.flatMap(r => r.checks.filter(x => x.tipo !== "global")); return [c.filter(x => x.ok).length, c.length]; };
  const perfeitas = rs => rs.filter(r => r.checks.every(x => x.ok)).length;
  const inventou = rs => rs.filter(r => r.checks.some(x => x.tipo === "global" && !x.ok)).length;

  // Consistência: para cada pergunta, as N repetições tiveram exatamente o mesmo veredito em todas as verificações?
  const consistencia = (t, perguntas) => {
    let iguais = 0, total = 0; const cvs = [];
    for (const q of perguntas) {
      const reps = de(t).filter(r => r.pergunta === q.id);
      if (reps.length < 2) continue;
      total++;
      const assin = reps.map(r => r.checks.map(x => (x.ok ? 1 : 0)).join(""));
      if (assin.every(a => a === assin[0])) iguais++;
      const p = reps.map(r => r.palavras); const m = media(p);
      if (m) cvs.push(dp(p) / m);
    }
    return { iguais, total, cv: media(cvs) };
  };

  let s = `# Resultados do experimento\n\n`;
  s += `Gerado a partir de \`${path.basename(arquivo)}\`.\n\n`;
  s += `- **Data:** ${new Date(ex.data).toLocaleString("pt-BR")}\n- **Modelo:** ${ex.provedor} · ${ex.modelo}\n`;
  s += `- **Desenho:** ${tipos.length} prompts × ${ex.perguntas.length} perguntas × ${ex.repeticoes} repetições = ${ex.resultados.length} respostas (${ex.resultados.length - ok.length} com erro)\n`;
  s += `- **Avaliação qualitativa:** ${ex.juiz ? "LLM avaliador às cegas, temperatura 0, notas de 1 a 5" : "não executada"}\n\n`;

  // ---- 1. resumo ----
  const conj = q => (porId[q.id]?.conjunto || "desenho");
  const desenho = ex.perguntas.filter(q => conj(q) === "desenho");
  const validacao = ex.perguntas.filter(q => conj(q) === "validacao");
  const tabelaGeral = perguntas => {
    const ids = new Set(perguntas.map(q => q.id));
    let t = cab(["Prompt", "Acerto nas regras", "Respostas 100% corretas", "Respostas c/ dado inventado", "Consistência entre execuções", "Variação de tamanho (CV)", "Palavras (média)", "Tokens entrada", "Tokens saída", "Latência (ms)"]) + "\n";
    for (const tp of tipos) {
      const rs = de(tp.id).filter(r => ids.has(r.pergunta)); if (!rs.length) continue;
      const [a, b] = regras(rs); const c = consistencia(tp.id, perguntas);
      t += linha([`**${tp.label}**`, pct(a, b), pct(perfeitas(rs), rs.length), pct(inventou(rs), rs.length),
        `${c.iguais}/${c.total}`, c.total ? (c.cv * 100).toFixed(0) + "%" : "–",
        f0(media(rs.map(r => r.palavras))), f0(media(rs.map(r => r.usage?.input ?? NaN))), f0(media(rs.map(r => r.usage?.output ?? NaN))), f0(media(rs.map(r => r.ms)))]) + "\n";
    }
    return t;
  };
  s += `## 1. Tabela comparativa geral\n\n`;
  if (validacao.length) {
    s += `### 1a. Conjunto de desenho (${desenho[0].id}–${desenho.at(-1).id})\n\n` + tabelaGeral(desenho) + "\n";
    s += `### 1b. Conjunto de validação (${validacao[0].id}–${validacao.at(-1).id})\n\nPerguntas escritas antes de testar o prompt recomendado e não usadas para ajustá-lo.\n\n` + tabelaGeral(validacao) + "\n";
    s += `### 1c. Todas as perguntas\n\n` + tabelaGeral(ex.perguntas);
  } else s += tabelaGeral(ex.perguntas);
  s += `\n- **Acerto nas regras:** % das verificações específicas de cada pergunta (o que precisa conter / não pode conter) que passaram.\n`;
  s += `- **Dado inventado:** a resposta citou um preço (R$) ou telefone que não está nos dados da loja nem é soma/divisão válida deles.\n`;
  s += `- **Consistência:** perguntas em que todas as repetições tiveram o mesmo veredito em todas as verificações.\n`;
  s += `- **CV:** coeficiente de variação do nº de palavras entre repetições da mesma pergunta (menor = mais estável).\n\n`;

  // ---- 2. qualitativo ----
  if (ex.juiz) {
    s += `## 2. Métricas qualitativas (avaliador às cegas, 1 a 5)\n\n`;
    s += cab(["Prompt", "Clareza", "Completude", "Tom corporativo", "Segurança", "Fidelidade (não inventar)", "Média", "Notas ≤ 2"]) + "\n";
    for (const t of tipos) {
      const rs = comJuiz(de(t.id)); if (!rs.length) continue;
      const ms = notas.map(n => media(rs.map(r => r.juiz[n])));
      const baixas = rs.filter(r => notas.some(n => r.juiz[n] <= 2)).length;
      s += linha([`**${t.label}**`, ...ms.map(f1), f1(media(ms)), `${baixas}/${rs.length}`]) + "\n";
    }
    const invalidas = ok.filter(r => r.juiz && !juizValido(r)).length;
    s += `\n*Notas ≤ 2: respostas com pelo menos um critério reprovado.*`;
    s += invalidas ? ` *${invalidas} avaliação(ões) descartada(s) por JSON malformado do avaliador.*\n\n` : "\n\n";
  }

  // ---- 3. por categoria ----
  s += `## 3. Acerto nas regras por categoria de pergunta\n\n`;
  const cats = [...new Set(ex.perguntas.map(q => q.cat))];
  s += cab(["Categoria", ...tipos.map(t => t.label)]) + "\n";
  for (const c of cats) {
    s += linha([CATEGORIAS[c] || c, ...tipos.map(t => { const [a, b] = regras(de(t.id).filter(r => r.cat === c)); return pct(a, b); })]) + "\n";
  }
  s += "\n";

  // ---- 4. por pergunta ----
  s += `## 4. Respostas 100% corretas por pergunta (de ${ex.repeticoes})\n\n`;
  s += cab(["Pergunta", ...tipos.map(t => t.label)]) + "\n";
  for (const q of ex.perguntas) {
    s += linha([`${q.id}${conj(q) === "validacao" ? " (val.)" : ""} · ${md1(q.texto)}`, ...tipos.map(t => {
      const rs = de(t.id).filter(r => r.pergunta === q.id);
      const n = perfeitas(rs); return rs.length ? (n === rs.length ? `${n}/${rs.length}` : `**${n}/${rs.length}**`) : "–";
    })]) + "\n";
  }
  s += "\n*Em negrito: houve pelo menos uma falha.*\n\n";

  // ---- 5. formato ----
  s += `## 5. Aderência ao formato estruturado\n\n`;
  s += `% das respostas com os 4 campos (Categoria, Resposta, Valores, Próximo passo). Só o prompt de saída estruturada pede esse formato; nos outros, o número mostra se o modelo o adota sem ser pedido.\n\n`;
  s += cab(["Prompt", "Com os 4 campos"]) + "\n";
  for (const t of tipos) { const rs = de(t.id); if (rs.length) s += linha([t.label, pct(rs.filter(r => r.formato).length, rs.length)]) + "\n"; }
  s += "\n";

  // ---- 6. falhas ----
  s += `## 6. Todas as falhas encontradas\n\n`;
  s += cab(["Prompt", "Pergunta", "Rep.", "Verificação que falhou", "Detalhe"]) + "\n";
  let nf = 0;
  for (const r of ok) for (const c of r.checks.filter(x => !x.ok)) {
    nf++; s += linha([L[r.tipo], r.pergunta, r.rep, c.nome, c.detalhe ? `\`${md1(c.detalhe)}\`` : ""]) + "\n";
  }
  if (!nf) s += "| – | – | – | nenhuma falha | |\n";
  s += "\n";

  // ---- 7. dataset ----
  s += `## 7. Dataset de perguntas\n\n`;
  s += cab(["ID", "Conjunto", "Categoria", "Pergunta do cliente", "Comportamento esperado", "Verificações"]) + "\n";
  for (const q of ex.perguntas) {
    const v = [...q.must.map(x => "✓ " + x), ...q.mustNot.map(x => "✗ " + x)].join("; ");
    s += linha([q.id, conj(q), CATEGORIAS[q.cat] || q.cat, md1(q.texto), md1(q.esperado), v || "só globais"]) + "\n";
  }
  s += `\nTodas as respostas também passam pelas verificações globais **sem preço inventado** e **sem telefone inventado**.\n`;

  // ---- anexo ----
  let a = `# Todas as respostas\n\nExecução \`${path.basename(arquivo)}\` · ${ex.provedor} · ${ex.modelo}\n\n`;
  for (const q of ex.perguntas) {
    a += `## ${q.id} · ${q.texto}\n\n*Esperado:* ${q.esperado}\n\n`;
    for (const t of tipos) for (const r of ex.resultados.filter(r => r.tipo === t.id && r.pergunta === q.id)) {
      a += `### ${t.label} · repetição ${r.rep}\n\n`;
      if (r.erro) { a += `> **Erro:** ${r.erro}\n\n`; continue; }
      a += r.texto.split("\n").map(l => "> " + l).join("\n") + "\n\n";
      const falhas = r.checks.filter(x => !x.ok).map(x => x.nome + (x.detalhe ? ` (${x.detalhe})` : ""));
      a += `- Verificações: ${falhas.length ? "❌ " + falhas.join("; ") : "✅ todas passaram"} · ${r.palavras} palavras\n`;
      if (juizValido(r)) a += `- Avaliador: clareza ${r.juiz.clareza} · completude ${r.juiz.completude} · tom ${r.juiz.tom} · segurança ${r.juiz.seguranca} · fidelidade ${r.juiz.fidelidade}. ${r.juiz.justificativa || ""}\n`;
      a += "\n";
    }
  }

  const dir = path.dirname(arquivo);
  await writeFile(path.join(dir, "RESULTADOS.md"), s);
  await writeFile(path.join(dir, "RESPOSTAS.md"), a);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error("Uso: node experimento/tabelas.mjs experimento/resultados/execucao-XXXX.json"); process.exit(1); }
  await gerarTabelas(process.argv[2]);
  console.log("RESULTADOS.md e RESPOSTAS.md gerados.");
}
