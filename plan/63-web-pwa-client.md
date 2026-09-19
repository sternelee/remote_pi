# 63 — Cliente web (PWA) no navegador

> **Status**: IMPLEMENTADO (2026-09-20). `web/` criado, testado e validado contra
> o relay real. Falta apenas a primeira publicação (deploy manual).

## Contexto

O Remote Pi tinha um cliente: o app Flutter (iOS/Android). Um cliente web resolve
três casos que o app não cobre — desktop, tablet, e máquina corporativa onde não
se instala nada — e, por ser PWA, não passa por revisão de loja.

Decisões de direção pedidas pelo usuário:

| # | Decisão |
|---|---|
| **A** | Deploy pelo [vinext](https://github.com/cloudflare/vinext) (API do Next.js 16 sobre Vite) em Cloudflare Workers |
| **B** | UI/UX pelo registry [brainless](https://brainless.swerdlow.dev/components) — componentes de transcrição de agente em estilo terminal |
| **C** | Cliente **completo** de relay: pareia por QR como o app, fala o mesmo protocolo |

A decisão C é a que define o escopo: o `pi-extension` só expõe Unix domain
socket localmente (broker UDS, supervisor), então um navegador **não** tem
caminho para um Pi na mesma máquina. A única rota é WSS até o relay — a mesma
que o app Flutter usa. Isso implica reimplementar no navegador o
challenge-response Ed25519, o pareamento e a persistência de identidade.

## Estrutura

Novo subprojeto `web/`, independente dos outros (sem task runner na raiz):

```
web/
├── app/                    # App Router: layout + page (shell pré-renderizado)
├── components/
│   ├── brainless/          # componentes do registry, vendorizados verbatim
│   └── pi/                 # PiApp, PairScreen, SessionScreen, Transcript, Composer
├── lib/
│   ├── protocol/           # types, codec, uuid7 (espelham pi-extension)
│   ├── crypto/ed25519.ts   # WebCrypto
│   ├── storage/store.ts    # IndexedDB: identidade, peers, settings
│   ├── pairing/qr.ts       # remotepi:// + URLs de relay
│   ├── relay/client.ts     # WS + challenge-response + reconexão
│   └── session/            # transcript (puro) + usePiSession (React)
├── test/                   # 71 testes: codec, reducer, render, relay client
├── tools/fake-pi.mjs       # harness de desenvolvimento
└── public/                 # manifest, service worker, ícones
```

O protocolo **não foi reinventado**: `lib/protocol/types.ts` espelha
`pi-extension/src/protocol/types.ts`, e o codec é testado contra
`.orchestration/contracts/fixtures/*.jsonl` — os mesmos bytes que Dart e Rust
decodificam. Ver `PROTOCOL.md` e `.orchestration/contracts/protocol.md`.

## Passos

### 1. Scaffold + build no Workers — FEITO

`pnpm create vinext-app@latest web --platform cloudflare`. O scaffold gera uma
combinação inconsistente (`@cloudflare/vite-plugin@^1.56.0` exige
`wrangler@^4.135.0`, que ainda não existe no npm) — fixado em `1.55.0`.

Aceite: `pnpm build` pré-renderiza `/` como estático. ✅

### 2. Camada de protocolo + testes contra as fixtures compartilhadas — FEITO

`types.ts`, `codec.ts`, `uuid7.ts`. Base64 normalizado para o padrão do relay
(url-safe do QR → standard); limite de 1 MiB do `ct` respeitado no cliente.

Aceite: round-trip de toda fixture não-control, linha a linha. ✅

### 3. Identidade e persistência — FEITO

Ed25519 via WebCrypto (sem fallback JS de propósito: uma curva feita à mão seria
pior que recusar). Identidade em IndexedDB como JWK — downgrade real em relação
ao Keychain, o mesmo que o extension já aceita em Linux headless.

Aceite: identidade gerada, 32 bytes de pubkey, assinatura de 64 bytes. ✅

### 4. Cliente de relay — FEITO

`hello` → `challenge` → `auth`, reconexão com backoff + jitter, ping de
protocolo e watchdog de socket morto.

Duas armadilhas do navegador, resolvidas no código:

- **`send()` antes de `onopen` lança `InvalidStateError`.** O `hello` sai do
  `onopen`, e existe `whenOnline()` para o chamador não enviar cedo demais.
- **Frames de controle WS são invisíveis para JS**, então o watchdog do
  extension ("nada chegou em N segundos") dispararia numa conexão ociosa
  saudável. A vivacidade é medida por `ping`/`pong` do protocolo + watchdog
  sobre tráfego *observável*.

Aceite: teste com WebSocket falso que reproduz a semântica do navegador. ✅

### 5. Pareamento — FEITO

Link colado ou QR pela câmera (`BarcodeDetector`, só Chromium/Android),
configuração de relay com detecção de divergência QR↔relay, `pair_ok`/`pair_error`
persistidos, lista de Pis pareados, "forget".

Aceite: `pair_request` → `pair_error{token_expired}` devolvido pelo Pi real. ✅

### 6. Transcrição — FEITO

Reducer puro (mensagens → timeline) + render com os componentes do brainless.
Cobre: turno do usuário, streaming do agente, tool call/result, diff unificado,
compactação, erro, `bye`, prompt interativo. `session_history` é **espelho**
(substitui), como no app.

Aceite: 13 testes de render sobre markup real, incluindo escape de HTML. ✅

### 7. PWA — FEITO

Manifest, ícones (do `branding/`), service worker (shell network-first, assets
com hash cache-first), instalável.

Aceite: manifest e ícones servidos com 200; SW registrado só em produção. ✅

### 8. Superfície de interação (paridade com o app) — FEITO

Segunda passada, referenciando o app Flutter (`app/lib/ui/chat/quick_actions`,
`app/lib/data/actions/actions_repository.dart`):

- **Quick actions**: `session_compact` ("Compact context"), `session_new` ("New
  session"), picker de modelo (`list_models` → `models_list` → `model_set`) e
  controle de thinking de 6 níveis (`thinking_set`), desabilitando níveis para
  modelo sem `reasoning`.
- **Steering**: com um turno rodando, Enter dobra o texto no turno vivo
  (`streaming_behavior: "steer"`) em vez de abrir um segundo; a UI mostra
  `steering…` até o Pi responder `steer_consumed`.
- **Fila de rascunho**: `queued_message_set`/`clear`, com o estado voltando por
  `queued_message_state` (a lista local nunca é mantida à mão).
- **Anexos**: uma imagem por mensagem, reduzida no dispositivo (JPEG, lado maior
  ≤1568px, q0.8) — o mesmo orçamento do app.
- **Prompts interativos**: single, multi, preview, texto livre e cancelar;
  respondidos pelo envelope `ask` com os **values** quando ele existe, e com o
  **label** quando não — a distinção vive em `lib/session/answers.ts`, porque
  errar é silencioso (o transporte aceita e o Pi descarta).
- **Reconexão automática** ao peer lembrado, como o app faz ao abrir.

Dois bugs reais encontrados e corrigidos nesta passada:

| Bug | Sintoma | Causa |
|---|---|---|
| `extension_ui_response` com `id` novo + `request_id` | a resposta nunca chegava ao pi-ask | o `id` **é** o id da request (o bridge roteia por ele) |
| `send()` logo após `start()` | `pair_request` descartado, só sintoma era timeout | socket ainda em CONNECTING; resolvido com `whenOnline()` e um `authSent` explícito |

Aceite: teste de integração sobre o relay real (`PI_LIVE=1`) que pareia,
espelha, assina rooms e dirige todas as ações, verificando no **registro do peer**
o que chegou — 105 testes. ✅

### 9. Primeira publicação — PENDENTE

`pnpm deploy` exige credencial Cloudflare (`wrangler login` ou
`CLOUDFLARE_API_TOKEN`) e um `name` em `wrangler.jsonc`. Deploy manual: `web/`
não entrou em `.github/workflows/`.

## Verificação executada

| Verificação | Resultado |
|---|---|
| `pnpm typecheck` | limpo |
| `pnpm test` (offline) | 104 testes, 7 arquivos |
| `pnpm test` com `PI_LIVE=1` | 105 testes — relay real, peer falso in-process |
| `pnpm test` com `PI_PAIR_LINK` | 106 testes — relay real, Pi real |
| `pnpm build` | pré-renderiza `/`, chunks servidos com 200 |
| Hydration no Worker construído | `__react*` presente no `<main>` |
| Challenge-response no relay de produção | 32 B nonce → 64 B assinatura → aceito |

O teste live imprime a resposta do Pi real:

```
[live] relay authenticated (statuses: connecting → authenticating → online)
[live] reply: {"type":"pair_error","code":"token_expired", …}
```

Um `pair_error` conta como sucesso do transporte: prova que o `pair_request`
chegou ao Pi (endereçamento de room correto) e que a resposta voltou e foi
decodificada. Silêncio é a falha que o teste existe para pegar — e foi
exatamente o que pegou o bug de `send()` antes do `onopen`.

## Definition of Done

- [x] `web/` com vinext + deploy em Workers configurado
- [x] Protocolo espelhado de `pi-extension`, testado contra as fixtures compartilhadas
- [x] Identidade Ed25519 + persistência em IndexedDB
- [x] Cliente de relay com reconexão e vivacidade correta no navegador
- [x] Pareamento (link + câmera) e lista de Pis pareados
- [x] Transcrição com os componentes do brainless (incl. diff e prompt interativo)
- [x] PWA instalável com service worker
- [x] Superfície de interação: quick actions (compact/new/model/thinking), steering,
      fila de rascunho, anexos de imagem, prompts multi/preview/freeform
- [x] Reconexão automática ao peer lembrado
- [x] Testes: codec, reducer, respostas, render, cliente de relay, integração opt-in
- [ ] Primeira publicação em Cloudflare (`pnpm deploy`)
- [ ] `web/` no CI (workflow próprio, como `cockpit-cli.yml`)

## Limites conhecidos (declarados no README)

Voz (o app transcreve on-device; o navegador precisaria da Web Speech API),
editar um rascunho da fila, modo `elaborate` do pi-ask, renderizar imagem
recebida, envio offline e E2E (não existe no protocolo). Ver `web/README.md`
§ "What is not".

## Próximos planos

- Publicar em Workers e ligar um domínio, para o PWA ser instalável de verdade
- Workflow de CI espelhando `cockpit-cli.yml` (typecheck + test)
- Voz no navegador (Web Speech API) para paridade com o app
- Modo `elaborate` do pi-ask e edição de rascunho na fila
