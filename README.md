# Contagem de Bebidas (protótipo)

Sistema simples para o funcionário registrar a contagem de estoque de bebidas pelo celular.
Cada contagem gera um e-mail para o dono, e **no fechamento** é enviado também um
**relatório final com as diferenças entre a abertura e o fechamento** do turno.

## Como funciona

1. O funcionário abre o app, digita o nome, escolhe o momento (Almoço/Jantar - Abertura/Fechamento) e toca em **Entrar**.
2. A contagem é feita **uma geladeira por vez**, nas abas **Gel. 1 → Gel. 2 → Gel. 3 → Total**.
   Dentro da geladeira, o funcionário digita a quantidade de cada bebida e toca no **✓**; o item seguinte só é liberado depois de confirmar o anterior.
   Se a bebida não está naquela geladeira, digita **0** (campo vazio não vale).
3. Ao confirmar todos os itens de uma geladeira, o app avisa e passa sozinho para a próxima. A Gel. 2 só é liberada com a Gel. 1 completa, e a Gel. 3 com a Gel. 2 completa.
4. Com as três geladeiras completas, abre a aba **Total** (item × G1, G2, G3 e soma) e o botão **Gerar relatório** é liberado.
   Para corrigir algo, é só voltar na aba da geladeira e tocar no ✓ do item: ele e os de baixo **da mesma geladeira** voltam a ser editáveis (os números digitados são mantidos). A geladeira volta a ficar incompleta e as seguintes ficam bloqueadas até ela ser refeita.
5. O servidor valida os dados, registra data/hora (fuso de Brasília, `DD-MM-AAAA` e `HH-MM`) e envia o(s) e-mail(s).

Se o celular recarregar a página no meio da contagem, ao entrar de novo com o **mesmo nome e o mesmo momento**
o progresso (geladeiras e itens já confirmados) é recuperado (vale por 12 horas e é apagado quando o relatório é enviado).

### Os e-mails

| Momento | E-mails enviados |
|---|---|
| Abertura (Almoço ou Jantar) | Comprovante da contagem, com **Geladeira 1, 2, 3 e Total** por item. A contagem fica guardada, em nome de quem contou. |
| Fechamento (Almoço ou Jantar) | Comprovante do fechamento (mesmas colunas) **+ Relatório final** com a contagem de **todos os funcionários** do turno. |

**Relatório final (por funcionário).** Para cada pessoa que contou naquele turno há um grupo de três colunas:
**Abertura | Fechamento | Diferença**, item a item, com a linha de total no fim. No topo aparece quem contou e a data e hora de cada contagem.

```
Item        |      João                |       José
            | Abert. Fech. Diferença   | Abert. Fech. Diferença
Coca-Cola   |   1      1      0        |   1      0      -1
Sprite      |   2      2      0        |   2      0      -2
```

- **Diferença = fechamento − abertura, da própria pessoa.** Negativo (vermelho): o estoque diminuiu. Positivo (verde): aumentou, por exemplo com reposição durante o turno.
- Cada pessoa é identificada pelo **nome digitado** (maiúsculas, acentos e espaços extras são ignorados: "João Silva" e "joao  silva" são a mesma pessoa). Peça para todos usarem sempre o mesmo nome.
- Se a mesma pessoa contar de novo o mesmo momento do turno, vale a **última** contagem dela.
- Se alguém só contou um dos momentos (por exemplo, só abriu), o outro aparece como "—" e a diferença dessa pessoa não é calculada.
- O relatório final é enviado **a cada fechamento** e traz tudo o que já foi registrado até ali. O e-mail do último a fechar é o completo; o assunto informa quantos fechamentos já entraram.
- Só entram contagens do **mesmo turno** (Almoço com Almoço, Jantar com Jantar) feitas nas **últimas 16 horas**, então o jantar que termina depois da meia-noite funciona e as contagens de ontem ficam de fora.
- Se ninguém tiver registrado a abertura do turno, o dono recebe o comprovante do fechamento e um e-mail de **aviso** ("Fechamento sem abertura"), e o funcionário vê um alerta na tela final.
- Os e-mails do fechamento são enviados juntos: ou saem todos, ou nenhum (e o funcionário pode tentar de novo).
- No celular, a tabela larga rola para o lado; no computador ela aparece inteira (até 4 pessoas cabem sem rolar).

## Lista de bebidas

A lista fica em **`itens.json`** e é usada tanto pelo celular quanto pelo servidor.
Para incluir, remover ou reordenar uma bebida, edite só esse arquivo (e coloque a imagem em `img/`):

```json
{ "id": "coca-cola", "nome": "Coca-Cola", "img": "img/coca-cola.svg" }
```

- `id`: identificador curto, sem espaços e **sem repetir**. Não mude o `id` de um item já em uso, senão a comparação de abertura × fechamento daquele item no turno em andamento é perdida.
- `img`: caminho da imagem. Pode ser `.png` ou `.jpg`; basta apontar para o arquivo.
- As imagens atuais são ilustrações genéricas (garrafa, lata, long neck). Troque por fotos reais quando quiser.
- Ao mudar a lista, publique de novo. Evite mudar no meio de um turno: uma abertura feita com a lista antiga fica sem os itens novos (eles contam como 0 na comparação).

## Geladeiras

Os nomes das geladeiras ficam em **`config.json`**:

```json
{ "geladeiras": ["Geladeira 1", "Geladeira 2", "Geladeira 3"] }
```

Para ter 4 geladeiras ou renomear (ex.: "Balcão"), edite só essa lista e publique de novo; as abas, a tabela Total e os e-mails acompanham.
A ordem da lista é a ordem em que as geladeiras são liberadas.
O **total é sempre calculado no servidor** a partir das geladeiras; o número que o celular manda não é usado.
Não troque a quantidade de geladeiras no meio de um turno: o rascunho salvo no celular é descartado e a comparação
com uma abertura feita com outra configuração pode ficar incompleta.

## Tecnologia

- Front-end: HTML + CSS + JavaScript puro.
- Função no servidor: `netlify/functions/relatorio.js` (JavaScript). Valida, guarda a abertura e envia os e-mails pelo [Resend](https://resend.com).
  A chave do Resend fica só no servidor, nunca no celular.
- Armazenamento da abertura: [Netlify Blobs](https://docs.netlify.com/blobs/overview/), incluído na Netlify, sem configuração extra.
- Python não é necessário.

## Publicar na Netlify

1. Crie uma conta gratuita no [Resend](https://resend.com) e gere uma **API Key**.
2. Publique a pasta de um destes jeitos (a função depende do pacote `@netlify/blobs`, que a Netlify instala a partir do `package.json`):
   - **GitHub:** suba a pasta para um repositório e conecte na Netlify (*Add new site > Import an existing project*). Recomendado.
   - **Linha de comando:** `netlify deploy --prod` dentro da pasta.
3. Em *Site configuration > Environment variables*, crie:

   | Variável | Valor |
   |---|---|
   | `RESEND_API_KEY` | chave gerada no Resend |
   | `EMAIL_DESTINO` | e-mail do dono (vários: separados por vírgula) |
   | `EMAIL_REMETENTE` | opcional, ex.: `Contagem <contagem@seudominio.com.br>` |

4. Faça um novo deploy para as variáveis valerem.

> Sem domínio verificado no Resend, o remetente padrão (`onboarding@resend.dev`) só entrega
> para o e-mail da própria conta do Resend. Para testar, use esse e-mail como `EMAIL_DESTINO`.
> Para produção, verifique um domínio no Resend e defina `EMAIL_REMETENTE`.

## Atalho no celular

Abra o endereço do site no Chrome (Android) e use *Menu > Adicionar à tela inicial* / *Instalar app*.
No iPhone, Safari > Compartilhar > *Adicionar à Tela de Início*.
Depois de atualizar o site, feche e abra o app uma ou duas vezes para ele carregar a versão nova.

## Testar no computador

```bash
npm install            # instala @netlify/blobs
npm i -g netlify-cli
netlify dev            # abre http://localhost:8888 com a função e o armazenamento funcionando
```

Crie um arquivo `.env` na pasta com `RESEND_API_KEY` e `EMAIL_DESTINO`.
O `.env` está no `.gitignore`: **não envie esse arquivo ao GitHub nem em zips que for compartilhar.**

Para testar o relatório final: faça uma contagem de **Almoço - Abertura**, depois outra de **Almoço - Fechamento** com números diferentes.

## Limites deste protótipo

- O histórico fica nos e-mails recebidos. O servidor guarda a contagem mais recente de cada pessoa em cada momento do turno (as de ontem são ignoradas).
- O nome é digitado livremente (sem senha). Qualquer pessoa com o link consegue enviar uma contagem. Se quiser limitar a 4 pessoas, dá para trocar o campo por uma lista fixa de nomes ou pedir um PIN.
- Se a internet cair no envio, o funcionário vê um aviso e pode tentar de novo sem perder as quantidades.
