// Recebe a contagem do celular, valida, e envia os e-mails (via Resend).
//
//  - Abertura:   guarda a contagem (Netlify Blobs) e envia o comprovante.
//  - Fechamento: envia o comprovante + o RELATÓRIO FINAL com a diferença
//                entre a abertura e o fechamento do mesmo turno.
//
// Variáveis de ambiente (Netlify > Site configuration > Environment variables):
//   RESEND_API_KEY   chave da API do Resend (obrigatória)
//   EMAIL_DESTINO    e-mail do dono; aceita vários separados por vírgula (obrigatória)
//   EMAIL_REMETENTE  ex.: "Contagem <contagem@seudominio.com.br>" (opcional)

const ITENS = require('../../itens.json'); // mesma lista usada pelo celular
const { geladeiras: GELADEIRAS } = require('../../config.json'); // nomes das geladeiras

const PERIODOS = [
  'Almoço - Abertura',
  'Almoço - Fechamento',
  'Jantar - Abertura',
  'Jantar - Fechamento'
];

// Uma contagem só entra no relatório final se tiver sido feita há no máximo 16 h
// (cobre o jantar que termina depois da meia-noite, mas não pega o dia anterior).
const VALIDADE_CONTAGEM_MS = 16 * 60 * 60 * 1000;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function resposta(status, corpo) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(corpo) };
}

// Mascarar o endereço de destino sem expor o endereço inteiro.
const mascarar = (email) => String(email).replace(/^(.)([^@]*)(@.*)$/, (_, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Data/hora sempre no fuso de Brasília, no formato pedido: DD-MM-AAAA e HH-MM
function dataHoraBrasilia(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(agora).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  return {
    data: `${partes.day}-${partes.month}-${partes.year}`,
    hora: `${partes.hour}-${partes.minute}`
  };
}

// Valida o corpo e devolve dados "limpos" (nomes dos itens vêm da lista do servidor)
function validar(corpo) {
  if (!corpo || typeof corpo !== 'object') return { erro: 'Dados inválidos.' };

  const nome = typeof corpo.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ') : '';
  if (nome.length < 2 || nome.length > 60) return { erro: 'Nome inválido.' };

  if (!PERIODOS.includes(corpo.periodo)) return { erro: 'Momento da contagem inválido.' };
  const [turno, momento] = corpo.periodo.split(' - ');

  if (!Array.isArray(corpo.itens)) return { erro: 'Itens ausentes.' };
  const porId = new Map(corpo.itens.map((x) => [x && x.id, x]));

  const itens = [];
  for (const ref of ITENS) {
    const recebido = porId.get(ref.id);
    if (!recebido) return { erro: `Item ausente: ${ref.nome}.` };
    if (!Array.isArray(recebido.geladeiras)) {
      return { erro: 'Versão antiga do app. Feche e abra o app novamente e refaça a contagem.' };
    }
    const g = recebido.geladeiras;
    if (g.length !== GELADEIRAS.length || !g.every((n) => Number.isInteger(n) && n >= 0 && n <= 9999)) {
      return { erro: `Quantidade inválida para ${ref.nome}.` };
    }
    // o total é sempre calculado aqui, nunca confiado ao celular
    itens.push({ id: ref.id, nome: ref.nome, geladeiras: g, qtd: g.reduce((a, b) => a + b, 0) });
  }
  return { nome, periodo: corpo.periodo, turno, momento, itens };
}

const soma = (itens) => itens.reduce((s, x) => s + x.qtd, 0);
const sinal = (n) => (n > 0 ? `+${n}` : String(n));

// ---------- E-mail 1: comprovante da contagem (abertura ou fechamento) ----------
function montarEmailContagem({ nome, periodo, itens }, { data, hora }) {
  const total = soma(itens);
  const totaisGel = GELADEIRAS.map((_, j) => itens.reduce((s, x) => s + x.geladeiras[j], 0));

  const texto = [
    'CONTAGEM DE BEBIDAS',
    '',
    `Funcionário: ${nome}`,
    `Momento: ${periodo}`,
    `Data: ${data}`,
    `Hora: ${hora}`,
    '',
    ...itens.map((x) =>
      `${x.nome}: ${GELADEIRAS.map((g, j) => `${g}: ${x.geladeiras[j]}`).join(' | ')} | Total: ${x.qtd}`),
    '',
    `TOTAIS: ${GELADEIRAS.map((g, j) => `${g}: ${totaisGel[j]}`).join(' | ')} | Total geral: ${total}`
  ].join('\n');

  const td = 'padding:7px 8px;border-bottom:1px solid #eee;text-align:right;';
  const th = 'padding:8px;text-align:right;font-size:12px;';
  const linhas = itens.map((x) =>
    `<tr><td style="padding:7px 8px;border-bottom:1px solid #eee">${esc(x.nome)}</td>` +
    x.geladeiras.map((n) => `<td style="${td}">${n}</td>`).join('') +
    `<td style="${td}font-weight:bold">${x.qtd}</td></tr>`
  ).join('');

  const html =
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#222">` +
    `<h2 style="color:#b3261e;margin-bottom:4px">Contagem de bebidas</h2>` +
    `<p style="margin:0 0 12px;color:#666">Comprovante de registro</p>` +
    `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">` +
    `<tr><td style="padding:4px 0;color:#666">Funcionário</td><td style="text-align:right"><strong>${esc(nome)}</strong></td></tr>` +
    `<tr><td style="padding:4px 0;color:#666">Momento</td><td style="text-align:right"><strong>${esc(periodo)}</strong></td></tr>` +
    `<tr><td style="padding:4px 0;color:#666">Data</td><td style="text-align:right"><strong>${data}</strong></td></tr>` +
    `<tr><td style="padding:4px 0;color:#666">Hora</td><td style="text-align:right"><strong>${hora}</strong></td></tr>` +
    `</table>` +
    `<table style="width:100%;border-collapse:collapse;border:1px solid #eee">` +
    `<tr style="background:#f6f3ef"><th style="padding:8px;text-align:left;font-size:12px">Item</th>` +
    GELADEIRAS.map((g) => `<th style="${th}">${esc(g)}</th>`).join('') +
    `<th style="${th}">Total</th></tr>` +
    linhas +
    `<tr style="background:#f6f3ef"><td style="padding:8px"><strong>Total</strong></td>` +
    totaisGel.map((n) => `<td style="padding:8px;text-align:right"><strong>${n}</strong></td>`).join('') +
    `<td style="padding:8px;text-align:right"><strong>${total}</strong></td></tr>` +
    `</table></div>`;

  return {
    assunto: `Contagem de bebidas - ${periodo} - ${data} ${hora} - ${nome}`,
    texto,
    html
  };
}

// ---------- Contagens por funcionário ----------
// Nome -> identificador estável ("João Silva" e "joao  silva" são a mesma pessoa)
function slugNome(nome) {
  return String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sem-nome';
}

// Uma chave por pessoa, momento e turno: ninguém sobrescreve a contagem do outro.
const chaveContagem = (momento, turno, nome) =>
  `${momento.toLowerCase()}/${slugNome(turno)}/${slugNome(nome)}`;

// Lê todas as contagens recentes (últimas 16 h) de um momento do turno.
async function lerContagens(store, momento, turno, instante) {
  const { blobs } = await store.list({ prefix: `${momento.toLowerCase()}/${slugNome(turno)}/` });
  const lidas = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return lidas.filter((c) => {
    if (!c || !c.ts || !c.nome || !Array.isArray(c.itens)) return false;
    const idade = instante - new Date(c.ts);
    return idade >= 0 && idade <= VALIDADE_CONTAGEM_MS;
  });
}

// Junta abertura e fechamento de cada pessoa (na ordem em que começaram a contar).
function agruparPorPessoa(aberturas, fechamentos) {
  const mapa = new Map();
  const add = (c, lado) => {
    const k = slugNome(c.nome);
    if (!mapa.has(k)) mapa.set(k, { nome: c.nome, ab: null, fe: null, primeiro: c.ts });
    const p = mapa.get(k);
    p[lado] = c;
    p.nome = c.nome;
    if (c.ts < p.primeiro) p.primeiro = c.ts;
  };
  aberturas.forEach((c) => add(c, 'ab'));
  fechamentos.forEach((c) => add(c, 'fe'));
  return [...mapa.values()].sort((a, b) => (a.primeiro < b.primeiro ? -1 : a.primeiro > b.primeiro ? 1 : 0));
}

// ---------- E-mail 2: relatório final (por funcionário) ----------
// Para cada pessoa: abertura | fechamento | diferença (= fechamento - abertura).
// Se a pessoa só contou um dos momentos, o outro fica "—" e não há diferença.
function tabelaPorPessoa(pessoas) {
  const qtdDe = (c, id) => {
    if (!c) return null;
    const x = c.itens.find((i) => i.id === id);
    return x ? x.qtd : 0;
  };
  const linhas = ITENS.map((ref) => ({
    nome: ref.nome,
    celulas: pessoas.map((p) => {
      const ab = qtdDe(p.ab, ref.id);
      const fe = qtdDe(p.fe, ref.id);
      return { ab, fe, dif: ab !== null && fe !== null ? fe - ab : null };
    })
  }));
  const totais = pessoas.map((_, j) => {
    const col = (k) => {
      const v = linhas.map((l) => l.celulas[j][k]).filter((x) => x !== null);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const ab = col('ab'), fe = col('fe');
    return { ab, fe, dif: ab !== null && fe !== null ? fe - ab : null };
  });
  return { linhas, totais };
}

function montarEmailFinal({ turno, pessoas, nFechamentos }, quando) {
  const { linhas, totais } = tabelaPorPessoa(pessoas);
  const v = (n) => (n === null ? '—' : String(n));
  const d = (n) => (n === null ? '—' : sinal(n));
  const quandoDe = (c) => (c ? `${c.data} ${c.hora}` : '—');

  // ----- texto simples -----
  const texto = [
    `RELATÓRIO FINAL - ${turno.toUpperCase()} - ${quando.data}`,
    '',
    'Quem contou (data e hora):',
    ...pessoas.map((p) => `- ${p.nome}: abertura ${quandoDe(p.ab)} | fechamento ${quandoDe(p.fe)}`),
    '',
    'Item | ' + pessoas.map((p) => p.nome).join(' | ') + '   (abertura -> fechamento (diferença))',
    ...linhas.map((l) => l.nome + ' | ' +
      l.celulas.map((c) => `${v(c.ab)} -> ${v(c.fe)} (${d(c.dif)})`).join(' | ')),
    '',
    'TOTAL | ' + totais.map((t) => `${v(t.ab)} -> ${v(t.fe)} (${d(t.dif)})`).join(' | '),
    '',
    'Diferença = fechamento - abertura. Negativo: o estoque diminuiu. Positivo: o estoque aumentou (ex.: reposição durante o turno).',
    '"—" = a pessoa não registrou esse momento neste turno.'
  ].join('\n');

  // ----- HTML -----
  const cor = (n) => (n === null ? '#999' : n < 0 ? '#b3261e' : n > 0 ? '#1b7f3b' : '#888');
  const borda = 'border-left:2px solid #d9d2c8;';
  const base = 'padding:6px 7px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;';
  const cel = (c, primeira) =>
    `<td style="${base}${primeira ? borda : ''}${c.ab === null ? 'color:#999;' : ''}">${v(c.ab)}</td>` +
    `<td style="${base}${c.fe === null ? 'color:#999;' : ''}">${v(c.fe)}</td>` +
    `<td style="${base}font-weight:bold;color:${cor(c.dif)}">${d(c.dif)}</td>`;

  const corpo = linhas.map((l) =>
    `<tr><td style="padding:6px 7px;border-bottom:1px solid #eee">${esc(l.nome)}</td>` +
    l.celulas.map((c) => cel(c, true)).join('') + `</tr>`
  ).join('');

  const th = 'padding:6px 7px;font-size:11px;color:#666;text-align:right;background:#f6f3ef;';
  const cab1 = pessoas.map((p) =>
    `<th colspan="3" style="${borda}padding:8px 7px;text-align:center;background:#f6f3ef;font-size:13px">${esc(p.nome)}</th>`
  ).join('');
  const cab2 = pessoas.map(() =>
    `<th style="${th}${borda}">Abertura</th><th style="${th}">Fechamento</th><th style="${th}">Diferença</th>`
  ).join('');
  const rodape = totais.map((t) =>
    `<td style="${base}${borda}background:#f6f3ef;font-weight:bold">${v(t.ab)}</td>` +
    `<td style="${base}background:#f6f3ef;font-weight:bold">${v(t.fe)}</td>` +
    `<td style="${base}background:#f6f3ef;font-weight:bold;color:${cor(t.dif)}">${d(t.dif)}</td>`
  ).join('');

  const quem = pessoas.map((p) =>
    `<div style="margin:0 0 8px;font-size:13px;color:#444"><strong style="color:#222">${esc(p.nome)}</strong><br>` +
    `<span style="white-space:nowrap">Abertura: ${esc(quandoDe(p.ab))}</span>&nbsp;&nbsp; ` +
    `<span style="white-space:nowrap">Fechamento: ${esc(quandoDe(p.fe))}</span></div>`
  ).join('');

  const html =
    `<div style="font-family:Arial,sans-serif;color:#222">` +
    `<h2 style="color:#b3261e;margin:0 0 4px">Relatório final - ${esc(turno)} - ${quando.data}</h2>` +
    `<p style="margin:0 0 12px;color:#666">Contagem por funcionário: abertura, fechamento e diferença</p>` +
    `<div style="margin-bottom:16px">${quem}</div>` +
    `<div style="overflow-x:auto">` +
    `<table style="border-collapse:collapse;font-size:12px;border:1px solid #eee">` +
    `<tr><th rowspan="2" style="padding:8px 7px;text-align:left;background:#f6f3ef;vertical-align:bottom">Item</th>${cab1}</tr>` +
    `<tr>${cab2}</tr>` +
    corpo +
    `<tr><td style="padding:7px;background:#f6f3ef"><strong>Total</strong></td>${rodape}</tr>` +
    `</table></div>` +
    `<p style="color:#666;font-size:12px;margin-top:12px">` +
    `Diferença = fechamento − abertura. Negativo: o estoque diminuiu. Positivo: o estoque aumentou (ex.: reposição durante o turno).<br>` +
    `“—” = a pessoa não registrou esse momento neste turno.</p>` +
    `</div>`;

  return {
    assunto: `Relatório final - ${turno} - ${quando.data} - ${nFechamentos} fechamento${nFechamentos === 1 ? '' : 's'} registrado${nFechamentos === 1 ? '' : 's'}`,
    texto,
    html
  };
}

// Fechamento sem abertura registrada (ou armazenamento com problema): avisa o dono em vez de ficar em silêncio
function montarEmailSemAbertura(fechamento, quando, falha) {
  const msg = falha
    ? `Não foi possível gerar o relatório final do ${fechamento.turno}: o armazenamento das contagens está com problema. ` +
      `Detalhe técnico: ${falha}`
    : `Não foi possível gerar o relatório final do ${fechamento.turno}: ` +
      `nenhuma contagem de abertura recente foi encontrada para este turno.`;
  return {
    assunto: `ATENÇÃO - Fechamento sem abertura - ${fechamento.turno} - ${quando.data}`,
    texto: `${msg}\n\nFechamento registrado por ${fechamento.nome} em ${quando.data} ${quando.hora}.\n` +
           `As quantidades do fechamento estão no e-mail de comprovante.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#222">` +
      `<h2 style="color:#b3261e">Fechamento sem abertura</h2>` +
      `<p>${esc(msg)}</p>` +
      `<p>Fechamento registrado por <strong>${esc(fechamento.nome)}</strong> em ${quando.data} ${quando.hora}.<br>` +
      `As quantidades do fechamento estão no e-mail de comprovante.</p></div>`
  };
}

// Acrescenta ao comprovante um aviso de que o armazenamento falhou (a contagem em si está completa no e-mail).
function comAvisoArmazenamento(email, detalhe) {
  const msg = 'Aviso: houve um problema ao guardar esta contagem no sistema, então ela pode não aparecer no relatório final. ' +
              'As quantidades abaixo estão corretas. Detalhe técnico: ' + detalhe;
  return {
    ...email,
    texto: `${msg}\n\n${email.texto}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto 12px;padding:10px 12px;` +
          `background:#fff4e5;border:1px solid #f0b95b;color:#7a4a00;font-size:13px">${esc(msg)}</div>${email.html}`
  };
}

// ---------- Armazenamento das contagens (Netlify Blobs) ----------
async function abrirStorePadrao(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  connectLambda(event); // necessário no formato clássico de função
  return getStore('contagem');
}

function criarHandler(deps = {}) {
  const abrirStore = deps.abrirStore || abrirStorePadrao;
  const agora = deps.agora || (() => new Date());
  const enviar = deps.fetch || ((...args) => fetch(...args));

  return async function handler(event) {
    if (event.httpMethod !== 'POST') return resposta(405, { ok: false, erro: 'Método não permitido.' });

    const chave = process.env.RESEND_API_KEY;
    const destino = (process.env.EMAIL_DESTINO || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!chave || destino.length === 0) {
      console.error('Faltam variáveis de ambiente RESEND_API_KEY / EMAIL_DESTINO');
      return resposta(500, { ok: false, erro: 'Sistema não configurado. Avise o responsável.' });
    }

    let corpo;
    try { corpo = JSON.parse(event.body || '{}'); }
    catch (e) { return resposta(400, { ok: false, erro: 'Dados inválidos.' }); }

    const dados = validar(corpo);
    if (dados.erro) return resposta(400, { ok: false, erro: dados.erro });

    const instante = agora();
    const quando = dataHoraBrasilia(instante);
    const emails = [montarEmailContagem(dados, quando)];
    let final;

    // O armazenamento só serve ao relatório final. Se falhar, o comprovante por e-mail continua saindo
    // e o dono é avisado (com o detalhe técnico), em vez de travar o funcionário.
    let store = null;
    let falhaArmazenamento = null;
    const registrarFalha = (etapa, e) => {
      console.error(etapa, e);
      if (!falhaArmazenamento) falhaArmazenamento = String((e && (e.name ? `${e.name}: ` : '') + (e.message || e)) || e).slice(0, 300);
    };
    try { store = await abrirStore(event); }
    catch (e) { registrarFalha('Erro ao abrir armazenamento', e); }

    // Contagem desta pessoa, guardada ANTES de enviar.
    const propria = {
      nome: dados.nome, data: quando.data, hora: quando.hora, ts: instante.toISOString(),
      itens: dados.itens.map(({ id, qtd, geladeiras }) => ({ id, qtd, geladeiras }))
    };
    if (store) {
      try { await store.setJSON(chaveContagem(dados.momento, dados.turno, dados.nome), propria); }
      catch (e) { registrarFalha('Erro ao guardar a contagem', e); }
    }

    if (dados.momento === 'Fechamento') {
      let aberturas = [];
      let fechamentos = [];
      if (store) {
        try { aberturas = await lerContagens(store, 'Abertura', dados.turno, instante); }
        catch (e) { registrarFalha('Erro ao ler as aberturas', e); }
        try { fechamentos = await lerContagens(store, 'Fechamento', dados.turno, instante); }
        catch (e) { registrarFalha('Erro ao ler os fechamentos', e); }
      }
      // garante a contagem que acabou de chegar, mesmo que a leitura ainda não a mostre
      fechamentos = fechamentos.filter((c) => slugNome(c.nome) !== slugNome(dados.nome)).concat(propria);

      if (aberturas.length) {
        emails.push(montarEmailFinal({
          turno: dados.turno,
          pessoas: agruparPorPessoa(aberturas, fechamentos),
          nFechamentos: fechamentos.length
        }, quando));
        final = 'enviado';
      } else {
        emails.push(montarEmailSemAbertura(dados, quando, falhaArmazenamento));
        final = 'sem_abertura';
      }
    }

    if (falhaArmazenamento) emails[0] = comAvisoArmazenamento(emails[0], falhaArmazenamento);

    // Um único envio em lote: os e-mails saem juntos ou nenhum sai.
    const remetente = process.env.EMAIL_REMETENTE || 'Contagem de Bebidas <onboarding@resend.dev>';
    try {
      const r = await enviar('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emails.map((m) => ({
          from: remetente, to: destino, subject: m.assunto, text: m.texto, html: m.html
        })))
      });
      if (!r.ok) {
        console.error('Resend respondeu', r.status, await r.text());
        return resposta(502, { ok: false, erro: 'Não foi possível enviar o e-mail. Tente novamente.' });
      }
      try {
        const aceito = typeof r.json === 'function' ? await r.json() : null;
        console.log('E-mails aceitos pelo Resend para', destino.map(mascarar).join(', '), JSON.stringify(aceito));
      } catch (e) { /* só log */ }
    } catch (e) {
      console.error('Erro ao chamar Resend', e);
      return resposta(502, { ok: false, erro: 'Não foi possível enviar o e-mail. Tente novamente.' });
    }

    return resposta(200, {
      ok: true, nome: dados.nome, periodo: dados.periodo,
      data: quando.data, hora: quando.hora, final, armazenamento: !falhaArmazenamento,
      para: destino.map(mascarar)
    });
  };
}

module.exports = {
  handler: criarHandler(),
  criarHandler, validar, dataHoraBrasilia, slugNome, agruparPorPessoa, lerContagens,
  montarEmailContagem, montarEmailFinal, montarEmailSemAbertura
};
