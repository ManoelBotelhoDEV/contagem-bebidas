(function () {
  'use strict';

  var ENDPOINT = '/.netlify/functions/relatorio';
  var RASCUNHO_KEY = 'rascunhoContagem';
  var RASCUNHO_VALIDADE_MS = 12 * 60 * 60 * 1000; // 12 horas

  var ITENS = []; // carregado de itens.json

  var $ = function (id) { return document.getElementById(id); };

  var telas = {
    login: $('tela-login'),
    contagem: $('tela-contagem'),
    final: $('tela-final')
  };

  var estado = {
    nome: '',
    periodo: '',
    confirmado: [],
    enviando: false
  };

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

  // ---- Lista de bebidas (fonte única: itens.json) ----
  function carregarItens() {
    return fetch('itens.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('itens');
        return r.json();
      })
      .then(function (lista) {
        if (!Array.isArray(lista) || !lista.length) throw new Error('itens');
        ITENS = lista;
      });
  }

  var carregando = carregarItens().catch(function () { /* tratado ao entrar */ });

  // ---- Rascunho (protege contra o celular recarregar a página no meio da contagem) ----
  function salvarRascunho() {
    try {
      localStorage.setItem(RASCUNHO_KEY, JSON.stringify({
        nome: estado.nome,
        periodo: estado.periodo,
        ts: Date.now(),
        ids: ITENS.map(function (x) { return x.id; }),
        valores: ITENS.map(function (_, i) { return $('qtd-' + i).value; }),
        confirmado: estado.confirmado
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
    (ITENS.length ? Promise.resolve() : carregarItens())
      .then(function () {
        erro.hidden = true;
        estado.nome = nome;
        estado.periodo = $('periodo').value;
        try { localStorage.setItem('ultimoNome', nome); } catch (e) {}

        $('topo-nome').textContent = nome;
        $('topo-periodo').textContent = estado.periodo;
        montarLista();
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

  // ---- Lista sequencial ----
  function montarLista() {
    estado.confirmado = ITENS.map(function () { return false; });
    estado.enviando = false;
    $('erro-envio').hidden = true;

    var ul = $('lista');
    ul.innerHTML = '';

    ITENS.forEach(function (item, i) {
      var li = document.createElement('li');
      li.className = 'item';
      li.id = 'item-' + i;
      li.innerHTML =
        '<img src="' + esc(item.img) + '" alt="" width="64" height="64">' +
        '<div class="nome">' + esc(item.nome) + '<small>unidades em estoque</small></div>' +
        '<div class="acao">' +
          '<input type="number" inputmode="numeric" min="0" max="9999" step="1" placeholder="0" ' +
                 'aria-label="Quantidade de ' + esc(item.nome) + '" id="qtd-' + i + '">' +
          '<button type="button" class="btn-check" id="ok-' + i + '" aria-label="Confirmar ' + esc(item.nome) + '">✓</button>' +
        '</div>';
      ul.appendChild(li);

      var input = li.querySelector('input');
      var botao = li.querySelector('.btn-check');

      input.addEventListener('input', function () {
        // só dígitos, sem sinais
        input.value = input.value.replace(/[^0-9]/g, '').slice(0, 4);
        atualizar();
        salvarRascunho();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !botao.disabled) botao.click();
      });
      botao.addEventListener('click', function () { alternar(i); });
    });

    var r = lerRascunho();
    if (r) {
      ITENS.forEach(function (_, i) {
        $('qtd-' + i).value = r.valores[i] || '';
        estado.confirmado[i] = !!r.confirmado[i] && /^\d{1,4}$/.test($('qtd-' + i).value);
      });
      atualizar(true);
    } else {
      atualizar();
    }
  }

  function valido(i) {
    var v = $('qtd-' + i).value;
    return v !== '' && /^\d{1,4}$/.test(v);
  }

  function alternar(i) {
    if (estado.confirmado[i]) {
      // desfaz esta confirmação e as seguintes (mantém os valores digitados)
      for (var k = i; k < ITENS.length; k++) estado.confirmado[k] = false;
    } else if (valido(i)) {
      estado.confirmado[i] = true;
    }
    atualizar(true);
    salvarRascunho();
  }

  // índice do item liberado agora (primeiro não confirmado)
  function indiceAtivo() {
    return estado.confirmado.indexOf(false);
  }

  function atualizar(focar) {
    var ativo = indiceAtivo();
    var total = ITENS.length;
    var feitos = estado.confirmado.filter(Boolean).length;

    ITENS.forEach(function (_, i) {
      var li = $('item-' + i);
      var input = $('qtd-' + i);
      var botao = $('ok-' + i);
      var conf = estado.confirmado[i];
      var liberado = (i === ativo);

      li.classList.toggle('confirmado', conf);
      li.classList.toggle('ativo', liberado);
      li.classList.toggle('bloqueado', !conf && !liberado);

      input.disabled = conf || !liberado;
      // item confirmado: botão fica habilitado para permitir desfazer
      botao.disabled = conf ? false : !(liberado && valido(i));
    });

    $('barra-prog').style.width = (feitos / total * 100) + '%';
    $('txt-prog').textContent = feitos + ' de ' + total + ' confirmados';
    $('btn-gerar').disabled = estado.enviando || feitos !== total;

    if (focar && ativo >= 0) {
      $('qtd-' + ativo).focus();
      $('item-' + ativo).scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ---- Gerar relatório ----
  function coletar() {
    return ITENS.map(function (item, i) {
      return { id: item.id, nome: item.nome, qtd: parseInt($('qtd-' + i).value, 10) };
    });
  }

  function gerar() {
    if (estado.enviando || estado.confirmado.indexOf(false) !== -1) return;

    var itens = coletar();
    var resumo = itens.map(function (x) { return x.nome + ': ' + x.qtd; }).join('\n');
    if (!window.confirm('Enviar o relatório com estas quantidades?\n\n' + resumo)) return;

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

    var html =
      '<div class="linha"><span>Funcionário</span><strong>' + esc(data.nome) + '</strong></div>' +
      '<div class="linha"><span>Momento</span><strong>' + esc(data.periodo) + '</strong></div>' +
      '<div class="linha"><span>Data</span><strong>' + esc(data.data) + '</strong></div>' +
      '<div class="linha"><span>Hora</span><strong>' + esc(data.hora) + '</strong></div>' +
      '<h2>Quantidades</h2>';
    itens.forEach(function (x) {
      html += '<div class="linha item-linha"><span>' + esc(x.nome) + '</span><strong>' + x.qtd + '</strong></div>';
    });
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
