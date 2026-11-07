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

// Uma abertura só vale para o fechamento se tiver sido feita há no máximo 16 h
// (cobre o jantar que termina depois da meia-noite, mas não pega o dia anterior).
const VALIDADE_ABERTURA_MS = 16 * 60 * 60 * 1000;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function resposta(status, corpo) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(corpo) };
}

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

// ---------- E-mail 2: relatório final (abertura x fechamento) ----------
// diferença = fechamento - abertura  (negativo: o estoque diminuiu)
function calcularDiferencas(abertura, fechamento) {
  const antes = new Map(abertura.itens.map((x) => [x.id, x.qtd]));
  return fechamento.itens.map((x) => {
    const ab = antes.has(x.id) ? antes.get(x.id) : 0;
    return { id: x.id, nome: x.nome, abertura: ab, fechamento: x.qtd, diferenca: x.qtd - ab };
  });
}

function montarEmailFinal(abertura, fechamento, quando) {
  const linhas = calcularDiferencas(abertura, fechamento);
  const totAb = linhas.reduce((s, x) => s + x.abertura, 0);
  const totFe = linhas.reduce((s, x) => s + x.fechamento, 0);
  const totDif = totFe - totAb;
  const comDif = linhas.filter((x) => x.diferenca !== 0).length;

  const cabecalho = [
    `RELATÓRIO FINAL - ${fechamento.turno.toUpperCase()}`,
    '',
    `Abertura:   ${abertura.nome} - ${abertura.data} ${abertura.hora}`,
    `Fechamento: ${fechamento.nome} - ${quando.data} ${quando.hora}`,
    ''
  ];
  const texto = [
    ...cabecalho,
    'Item | Abertura | Fechamento | Diferença',
    ...linhas.map((x) => `${x.nome} | ${x.abertura} | ${x.fechamento} | ${sinal(x.diferenca)}`),
    '',
    `TOTAL | ${totAb} | ${totFe} | ${sinal(totDif)}`,
    `Itens com diferença: ${comDif} de ${linhas.length}`,
    '',
    'Diferença = fechamento - abertura. Negativo: o estoque diminuiu. Positivo: o estoque aumentou (ex.: reposição durante o turno).'
  ].join('\n');

  const cor = (n) => (n < 0 ? '#b3261e' : n > 0 ? '#1b7f3b' : '#888');
  const td = 'padding:7px 10px;border-bottom:1px solid #eee;';
  const corpo = linhas.map((x) =>
    `<tr><td style="${td}">${esc(x.nome)}</td>` +
    `<td style="${td}text-align:right">${x.abertura}</td>` +
    `<td style="${td}text-align:right">${x.fechamento}</td>` +
    `<td style="${td}text-align:right;font-weight:bold;color:${cor(x.diferenca)}">${sinal(x.diferenca)}</td></tr>`
  ).join('');

  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">` +
    `<h2 style="color:#b3261e;margin-bottom:4px">Relatório final - ${esc(fechamento.turno)}</h2>` +
    `<p style="margin:0 0 12px;color:#666">Diferenças entre a abertura e o fechamento</p>` +
    `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">` +
    `<tr><td style="padding:4px 0;color:#666">Abertura</td><td style="text-align:right"><strong>${esc(abertura.nome)}</strong> - ${esc(abertura.data)} ${esc(abertura.hora)}</td></tr>` +
    `<tr><td style="padding:4px 0;color:#666">Fechamento</td><td style="text-align:right"><strong>${esc(fechamento.nome)}</strong> - ${quando.data} ${quando.hora}</td></tr>` +
    `</table>` +
    `<table style="width:100%;border-collapse:collapse;border:1px solid #eee">` +
    `<tr style="background:#f6f3ef"><th style="padding:8px 10px;text-align:left">Item</th>` +
    `<th style="padding:8px 10px;text-align:right">Abertura</th><th style="padding:8px 10px;text-align:right">Fechamento</th>` +
    `<th style="padding:8px 10px;text-align:right">Diferença</th></tr>` +
    corpo +
    `<tr style="background:#f6f3ef"><td style="padding:8px 10px"><strong>Total</strong></td>` +
    `<td style="padding:8px 10px;text-align:right"><strong>${totAb}</strong></td>` +
    `<td style="padding:8px 10px;text-align:right"><strong>${totFe}</strong></td>` +
    `<td style="padding:8px 10px;text-align:right;font-weight:bold;color:${cor(totDif)}">${sinal(totDif)}</td></tr>` +
    `</table>` +
    `<p style="color:#666;font-size:13px">Itens com diferença: <strong>${comDif}</strong> de ${linhas.length}.<br>` +
    `Diferença = fechamento − abertura. Negativo: o estoque diminuiu. Positivo: o estoque aumentou (ex.: reposição durante o turno).</p>` +
    `</div>`;

  return {
    assunto: `Relatório final - ${fechamento.periodo.split(' - ')[0]} - ${quando.data} - diferenças abertura x fechamento`,
    texto,
    html
  };
}

// Fechamento sem abertura registrada: avisa o dono em vez de ficar em silêncio
function montarEmailSemAbertura(fechamento, quando) {
  const msg =
    `Não foi possível gerar o relatório final do ${fechamento.turno}: ` +
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

// ---------- Armazenamento da abertura (Netlify Blobs) ----------
async function abrirStorePadrao(event) {
  const { connectLambda, getStore } = require('@netlify/blobs');
  connectLambda(event); // necessário no formato clássico de função
  return getStore('contagem');
}

const chaveAbertura = (turno) => `abertura/${turno}`;

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

    let store;
    try { store = await abrirStore(event); }
    catch (e) {
      console.error('Erro ao abrir armazenamento', e);
      return resposta(500, { ok: false, erro: 'Armazenamento indisponível. Avise o responsável.' });
    }

    if (dados.momento === 'Abertura') {
      // Guarda ANTES de enviar: se algo falhar, o funcionário tenta de novo sem duplicar nada.
      try {
        await store.setJSON(chaveAbertura(dados.turno), {
          nome: dados.nome, data: quando.data, hora: quando.hora,
          ts: instante.toISOString(), itens: dados.itens.map(({ id, qtd, geladeiras }) => ({ id, qtd, geladeiras }))
        });
      } catch (e) {
        console.error('Erro ao guardar a abertura', e);
        return resposta(500, { ok: false, erro: 'Não foi possível registrar a abertura. Tente novamente.' });
      }
    } else {
      let abertura = null;
      try {
        const salva = await store.get(chaveAbertura(dados.turno), { type: 'json' });
        const idade = salva && salva.ts ? instante - new Date(salva.ts) : Infinity;
        if (salva && idade >= 0 && idade <= VALIDADE_ABERTURA_MS) abertura = salva;
      } catch (e) {
        console.error('Erro ao ler a abertura', e);
      }

      if (abertura) {
        emails.push(montarEmailFinal(abertura, dados, quando));
        final = 'enviado';
      } else {
        emails.push(montarEmailSemAbertura(dados, quando));
        final = 'sem_abertura';
      }
    }

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
    } catch (e) {
      console.error('Erro ao chamar Resend', e);
      return resposta(502, { ok: false, erro: 'Não foi possível enviar o e-mail. Tente novamente.' });
    }

    return resposta(200, {
      ok: true, nome: dados.nome, periodo: dados.periodo,
      data: quando.data, hora: quando.hora, final
    });
  };
}

module.exports = {
  handler: criarHandler(),
  criarHandler, validar, dataHoraBrasilia, calcularDiferencas,
  montarEmailContagem, montarEmailFinal, montarEmailSemAbertura
};
