(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/relatorio';
  var RASCUNHO_KEY = 'rascunhoContagemV3';
  var RASCUNHO_VALIDADE_MS = 12 * 60 * 60 * 1000; // 12 horas

  var ITENS = [];       // carregado de itens.json
  var GELADEIRAS = [];  // carregado de config.json (nomes das geladeiras)

  var $ = function (id) { return document.getElementById(id); };

  var telas = {
    login: $('tela-login'),
    contagem: $('tela-contagem'),
    final: $('tela-final')
  };

  // conf[f][i] = o item i da geladeira f foi confirmado
  // tab: 0..F-1 = geladeira; F = aba "Total"
  var estado = { nome: '', periodo: '', conf: [], tab: 0, enviando: false };

  function mostrar(nomeTela) {
    Object.keys(telas).forEach(function (k) {
      telas[k].classList.toggle('ativa', k === nomeTela);
    });
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- Dados (fonte única: itens.json e config.json) ----
  function buscarJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url);
      return r.json();
    });
  }

  function carregarDados() {
    return Promise.all([buscarJson('itens.json'), buscarJson('config.json')]).then(function (res) {
      var lista = res[0], cfg = res[1];
      if (!Array.isArray(lista) || !lista.length) throw new Error('itens');
      if (!cfg || !Array.isArray(cfg.geladeiras) || !cfg.geladeiras.length) throw new Error('config');
      ITENS = lista;
      GELADEIRAS = cfg.geladeiras;
    });
  }

  carregarDados().catch(function () { /* tratado ao entrar */ });

  var campoId = function (f, i) { return 'qtd-' + f + '-' + i; };
  var campo = function (f, i) { return $(campoId(f, i)); };
  var botao = function (f, i) { return $('ok-' + f + '-' + i); };
  var ehNumero = function (v) { return /^\d{1,4}$/.test(v); };
  var abrev = function (g) { return g.replace(/^Geladeira\s+/i, 'Gel. '); };
  var abrevCurta = function (g) { return g.replace(/^Geladeira\s+/i, 'G'); }; // cabeçalho da tabela Total

  // ---- Regras do fluxo ----
  function valido(f, i) { return ehNumero(campo(f, i).value); }
  function concluida(f) { return estado.conf[f].every(Boolean); }
  function feitos(f) { return estado.conf[f].filter(Boolean).length; }
  // uma geladeira só é liberada quando todas as anteriores estão completas
  function liberada(f) {
    for (var k = 0; k < f; k++) if (!concluida(k)) return false;
    return true;
  }
  function tudoPronto() { return GELADEIRAS.every(function (_, f) { return concluida(f); }); }
  // item liberado dentro da geladeira (o primeiro ainda não confirmado)
  function indiceAtivo(f) { return estado.conf[f].indexOf(false); }
  // primeira geladeira ainda incompleta (ou -1 se tudo pronto)
  function primeiraIncompleta() {
    for (var f = 0; f < GELADEIRAS.length; f++) if (!concluida(f)) return f;
    return -1;
  }
  function totalItem(i) {
    return GELADEIRAS.reduce(function (s, _, f) {
      var v = campo(f, i).value;
      return s + (ehNumero(v) ? parseInt(v, 10) : 0);
    }, 0);
  }

  // ---- Rascunho (protege contra o celular recarregar a página no meio da contagem) ----
  function salvarRascunho() {
    try {
      localStorage.setItem(RASCUNHO_KEY, JSON.stringify({
        nome: estado.nome,
        periodo: estado.periodo,
        ts: Date.now(),
        ids: ITENS.map(function (x) { return x.id; }),
        geladeiras: GELADEIRAS,
        valores: GELADEIRAS.map(function (_, f) {
          return ITENS.map(function (_, i) { return campo(f, i).value; });
        }),
        conf: estado.conf
      }));
    } catch (e) {}
  }

  function lerRascunho() {
    try {
      var r = JSON.parse(localStorage.getItem(RASCUNHO_KEY) || 'null');
      if (!r || Date.now() - r.ts > RASCUNHO_VALIDADE_MS) return null;
      if (r.nome !== estado.nome || r.periodo !== estado.periodo) return null;
      var ids = ITENS.map(function (x) { return x.id; });
      if (JSON.stringify(r.ids) !== JSON.stringify(ids)) return null;
      if (JSON.stringify(r.geladeiras) !== JSON.stringify(GELADEIRAS)) return null;
      return r;
    } catch (e) { return null; }
  }

  function limparRascunho() {
    try { localStorage.removeItem(RASCUNHO_KEY); } catch (e) {}
  }

  // ---- Login ----
  var lembrado = '';
  try { lembrado = localStorage.getItem('ultimoNome') || ''; } catch (e) {}
  if (lembrado) $('nome').value = lembrado;

  function entrar() {
    var nome = $('nome').value.trim().replace(/\s+/g, ' ');
    var erro = $('erro-login');
    if (nome.length < 2) {
      erro.textContent = 'Digite seu nome para entrar.';
      erro.hidden = false;
      $('nome').focus();
      return;
    }

    var btn = $('btn-entrar');
    btn.disabled = true;
    (ITENS.length ? Promise.resolve() : carregarDados())
      .then(function () {
        erro.hidden = true;
        estado.nome = nome;
        estado.periodo = $('periodo').value;
        try { localStorage.setItem('ultimoNome', nome); } catch (e) {}

        $('topo-nome').textContent = nome;
        $('topo-periodo').textContent = estado.periodo;
        montarTela();
        mostrar('contagem');
      })
      .catch(function () {
        erro.textContent = 'Não foi possível carregar a lista de bebidas. Verifique a internet e tente de novo.';
        erro.hidden = false;
      })
      .then(function () { btn.disabled = false; });
  }

  $('btn-entrar').addEventListener('click', entrar);
  $('nome').addEventListener('keydown', function (e) { if (e.key === 'Enter') entrar(); });

  $('btn-sair').addEventListener('click', function () {
    // o rascunho fica salvo: ao entrar de novo com o mesmo nome e momento, a contagem continua
    mostrar('login');
  });

  // ---- Montagem da tela: abas + uma lista por geladeira ----
  function montarTela() {
    var F = GELADEIRAS.length;
    estado.conf = GELADEIRAS.map(function () { return ITENS.map(function () { return false; }); });
    estado.tab = 0;
    estado.enviando = false;
    $('erro-envio').hidden = true;
    $('aviso-etapa').hidden = true;

    // abas
    var nav = $('abas');
    nav.innerHTML = '';
    GELADEIRAS.forEach(function (g, f) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'aba'; b.id = 'aba-' + f;
      b.innerHTML = '<b>' + esc(abrev(g)) + '</b><small></small>';
      b.addEventListener('click', function () { irParaAba(f); });
      nav.appendChild(b);
    });
    var bt = document.createElement('button');
    bt.type = 'button'; bt.className = 'aba'; bt.id = 'aba-' + F;
    bt.innerHTML = '<b>Total</b><small>resumo</small>';
    bt.addEventListener('click', function () { irParaAba(F); });
    nav.appendChild(bt);

    // listas
    var cont = $('listas');
    cont.innerHTML = '';
    GELADEIRAS.forEach(function (g, f) {
      var ul = document.createElement('ul');
      ul.className = 'lista'; ul.id = 'lista-' + f;

      ITENS.forEach(function (item, i) {
        var li = document.createElement('li');
        li.className = 'item'; li.id = 'item-' + f + '-' + i;
        li.innerHTML =
          '<img src="' + esc(item.img) + '" alt="" width="64" height="64">' +
          '<div class="nome">' + esc(item.nome) + '<small>unidades nesta geladeira</small></div>' +
          '<div class="acao">' +
            '<input type="number" inputmode="numeric" min="0" max="9999" step="1" placeholder="0" ' +
                   'aria-label="' + esc(item.nome) + ' - ' + esc(g) + '" id="' + campoId(f, i) + '">' +
            '<button type="button" class="btn-check" id="ok-' + f + '-' + i + '" aria-label="Confirmar ' + esc(item.nome) + '">✓</button>' +
          '</div>';
        ul.appendChild(li);

        var input = li.querySelector('input');
        var ok = li.querySelector('.btn-check');
        input.addEventListener('input', function () {
          // só dígitos, sem sinais
          input.value = input.value.replace(/[^0-9]/g, '').slice(0, 4);
          atualizar();
          salvarRascunho();
        });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !ok.disabled) ok.click();
        });
        ok.addEventListener('click', function () { alternar(f, i); });
      });
      cont.appendChild(ul);
    });

    // rascunho
    var r = lerRascunho();
    if (r) {
      GELADEIRAS.forEach(function (_, f) {
        var quebrou = false;
        ITENS.forEach(function (_, i) {
          campo(f, i).value = (r.valores[f] && r.valores[f][i]) || '';
          var c = !!(r.conf[f] && r.conf[f][i]) && valido(f, i);
          if (!c) quebrou = true;
          estado.conf[f][i] = c && !quebrou; // confirmações sempre em sequência
        });
      });
      var pi = primeiraIncompleta();
      estado.tab = pi === -1 ? F : pi;
    }
    atualizar(true);
  }

  function irParaAba(t) {
    if ($('aba-' + t).disabled) return;
    estado.tab = t;
    $('aviso-etapa').hidden = true;
    atualizar();
    window.scrollTo(0, 0);
    if (t < GELADEIRAS.length) {
      var idx = indiceAtivo(t);
      if (idx >= 0) $('item-' + t + '-' + idx).scrollIntoView({ block: 'center' });
    }
  }

  // ---- Confirmar / desfazer ----
  function alternar(f, i) {
    var antes = concluida(f);
    if (estado.conf[f][i]) {
      // desfaz este item e os seguintes DESTA geladeira (mantém os números digitados)
      for (var k = i; k < ITENS.length; k++) estado.conf[f][k] = false;
    } else if (valido(f, i)) {
      estado.conf[f][i] = true;
    }
    if (!antes && concluida(f)) avancar(f);
    else atualizar(true);
    salvarRascunho();
  }

  // geladeira completa: vai para a próxima que falta (ou para o resumo)
  function avancar(f) {
    var F = GELADEIRAS.length;
    var prox = primeiraIncompleta();
    var aviso = $('aviso-etapa');
    if (prox === -1) {
      estado.tab = F;
      aviso.textContent = GELADEIRAS[f] + ' concluída. Todas as geladeiras foram contadas: confira o total e gere o relatório.';
    } else {
      estado.tab = prox;
      aviso.textContent = GELADEIRAS[f] + ' concluída. Agora conte a ' + GELADEIRAS[prox] + '.';
    }
    aviso.hidden = false;
    atualizar(true);
    window.scrollTo(0, 0);
  }

  // ---- Atualiza toda a interface a partir do estado ----
  function atualizar(focar) {
    var F = GELADEIRAS.length, N = ITENS.length;

    // garante que a aba atual é válida
    if (estado.tab === F && !tudoPronto()) estado.tab = primeiraIncompleta();
    else if (estado.tab < F && !liberada(estado.tab)) estado.tab = primeiraIncompleta();

    GELADEIRAS.forEach(function (_, f) {
      $('lista-' + f).hidden = (estado.tab !== f);
      var ativo = liberada(f) ? indiceAtivo(f) : -1;

      ITENS.forEach(function (_, i) {
        var li = $('item-' + f + '-' + i);
        var conf = estado.conf[f][i];
        var liberado = (i === ativo);
        li.classList.toggle('confirmado', conf);
        li.classList.toggle('ativo', liberado);
        li.classList.toggle('bloqueado', !conf && !liberado);
        campo(f, i).disabled = conf || !liberado;
        // item confirmado: botão fica habilitado para permitir desfazer
        botao(f, i).disabled = conf ? false : !(liberado && valido(f, i));
      });

      var aba = $('aba-' + f);
      aba.disabled = !liberada(f);
      aba.classList.toggle('ativa', estado.tab === f);
      aba.classList.toggle('concluida', concluida(f));
      aba.querySelector('small').textContent = (concluida(f) ? '✓ ' : '') + feitos(f) + '/' + N;
    });

    var abaTotal = $('aba-' + F);
    abaTotal.disabled = !tudoPronto();
    abaTotal.classList.toggle('ativa', estado.tab === F);
    abaTotal.classList.toggle('concluida', tudoPronto());

    $('painel-total').hidden = (estado.tab !== F);
    $('bloco-prog').hidden = (estado.tab === F);
    if (estado.tab < F) {
      var n = feitos(estado.tab);
      $('barra-prog').style.width = (n / N * 100) + '%';
      $('txt-prog').textContent = GELADEIRAS[estado.tab] + ': ' + n + ' de ' + N + ' confirmados';
    } else {
      renderTotal();
    }

    $('btn-gerar').disabled = estado.enviando || !tudoPronto();

    if (focar && estado.tab < F) {
      var idx = indiceAtivo(estado.tab);
      if (idx >= 0) {
        campo(estado.tab, idx).focus();
        $('item-' + estado.tab + '-' + idx).scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }

  // ---- Aba "Total": cada item x geladeiras + soma ----
  function renderTotal() {
    var soma = GELADEIRAS.map(function () { return 0; });
    var geral = 0;
    var html = '<table class="tabela-total"><thead><tr><th>Item</th>' +
      GELADEIRAS.map(function (g) { return '<th>' + esc(abrevCurta(g)) + '</th>'; }).join('') +
      '<th>Total</th></tr></thead><tbody>';

    ITENS.forEach(function (item, i) {
      html += '<tr><td>' + esc(item.nome) + '</td>';
      GELADEIRAS.forEach(function (_, f) {
        var v = ehNumero(campo(f, i).value) ? parseInt(campo(f, i).value, 10) : 0;
        soma[f] += v;
        html += '<td>' + v + '</td>';
      });
      var t = totalItem(i);
      geral += t;
      html += '<td class="t">' + t + '</td></tr>';
    });

    html += '</tbody><tfoot><tr><td>Total geral</td>' +
      soma.map(function (n) { return '<td>' + n + '</td>'; }).join('') +
      '<td class="t">' + geral + '</td></tr></tfoot></table>' +
      '<p class="dica">Para corrigir algo, volte na aba da geladeira e toque no ✓ do item.</p>';
    $('painel-total').innerHTML = html;
  }

  // ---- Gerar relatório ----
  function coletar() {
    return ITENS.map(function (item, i) {
      var g = GELADEIRAS.map(function (_, f) { return parseInt(campo(f, i).value, 10); });
      return { id: item.id, nome: item.nome, geladeiras: g, qtd: g.reduce(function (a, b) { return a + b; }, 0) };
    });
  }

  function gerar() {
    if (estado.enviando || !tudoPronto()) return;

    var itens = coletar();
    var resumo = itens.map(function (x) {
      return x.nome + ': ' + x.qtd + ' (' + x.geladeiras.join(' / ') + ')';
    }).join('\n');
    if (!window.confirm('Enviar o relatório com estas quantidades?\n(total e geladeiras)\n\n' + resumo)) return;

    estado.enviando = true;
    var btn = $('btn-gerar');
    btn.textContent = 'Enviando…';
    btn.disabled = true;
    $('erro-envio').hidden = true;

    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 25000);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome: estado.nome, periodo: estado.periodo, itens: itens }),
      signal: ctl.signal
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok || !data.ok) throw new Error(data.erro || 'Falha ao enviar o relatório.');
          return data;
        });
      })
      .then(function (data) {
        limparRascunho();
        mostrarFinal(data, itens);
      })
      .catch(function (err) {
        var msg = err.name === 'AbortError'
          ? 'Tempo esgotado. Verifique a internet e tente de novo.'
          : (err.message || 'Falha ao enviar. Tente de novo.');
        $('erro-envio').textContent = msg + ' Suas quantidades foram mantidas.';
        $('erro-envio').hidden = false;
      })
      .then(function () {
        clearTimeout(timer);
        estado.enviando = false;
        btn.textContent = 'Gerar relatório';
        atualizar();
      });
  }

  $('btn-gerar').addEventListener('click', gerar);

  function mostrarFinal(data, itens) {
    var msg = 'O relatório foi enviado por e-mail ao responsável.';
    var aviso = $('final-aviso');
    aviso.hidden = true;

    if (data.final === 'enviado') {
      msg = 'Relatório enviado. O relatório final com as diferenças entre abertura e fechamento também foi enviado.';
    } else if (data.final === 'sem_abertura') {
      msg = 'Relatório de fechamento enviado.';
      aviso.textContent = 'Atenção: não encontramos a contagem de abertura deste turno, então não foi possível calcular as diferenças. O responsável foi avisado por e-mail.';
      aviso.hidden = false;
    }
    $('final-msg').textContent = msg;

    var geral = 0;
    var html =
      '<div class="linha"><span>Funcionário</span><strong>' + esc(data.nome) + '</strong></div>' +
      '<div class="linha"><span>Momento</span><strong>' + esc(data.periodo) + '</strong></div>' +
      '<div class="linha"><span>Data</span><strong>' + esc(data.data) + '</strong></div>' +
      '<div class="linha"><span>Hora</span><strong>' + esc(data.hora) + '</strong></div>' +
      '<h2>Quantidades</h2>';
    itens.forEach(function (x) {
      geral += x.qtd;
      var detalhe = x.geladeiras.map(function (n, j) { return 'G' + (j + 1) + ' ' + n; }).join(' · ');
      html += '<div class="linha item-linha"><span>' + esc(x.nome) + '<small>' + esc(detalhe) + '</small></span>' +
              '<strong>' + x.qtd + '</strong></div>';
    });
    html += '<div class="linha item-linha total-geral"><span>Total geral</span><strong>' + geral + '</strong></div>';
    $('comprovante').innerHTML = html;
    mostrar('final');
  }

  $('btn-nova').addEventListener('click', function () { mostrar('login'); });

  // ---- PWA: service worker simples (permite abrir o app instalado) ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
