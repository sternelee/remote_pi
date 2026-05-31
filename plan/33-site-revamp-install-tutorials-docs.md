# Plano 33 — Revamp do Site: install curl, Tutoriais e Doc→Referência

**Objetivo**: enxugar a home (hoje inchada com 2–3 walkthroughs de install) e a
doc (página única de 1273 linhas), reposicionando Remote Pi como **plugin do Pi**
com onboarding de baixa fricção. Três frentes novas no site: (1) **install curl**
de um comando como herói, (2) uma **seção de Tutoriais** mão-na-massa irmã da Doc,
(3) uma página de decisão **"Por que Pi"**; e a Doc reduzida a **Referência**.

Resultado esperado: o visitante entende em 5 segundos que é "controle remoto pros
seus agentes de código pelo celular", instala com **um comando**, aprende a usar
por **tutoriais guiados**, e consulta detalhes numa **referência enxuta** — sem ver
a mesma coisa escrita em três lugares.

## Por que essa direção (consenso da entrevista 2026-05-31)

A home tenta ser landing + tutorial + referência ao mesmo tempo, e a doc empilha
aprender/executar/consultar num scroll só. O remédio não é cortar conteúdo — é
**dar endereço certo pra cada tipo** (Diátaxis): tutorial = aprender fazendo;
referência = consultar sob demanda; decisão = convencer antes do install.

### Decisões fixadas (entrevista)

| # | Decisão | Valor |
|---|---|---|
| 1 | **Posicionamento da home** | "Plugin do Pi" — vocabulário do Pi, simples. Gateway/standalone (OpenClow/Hermes) sai do hero, vira tutorial avançado |
| 2 | **Install** | Componente de **abas** (EN): aba **"No Pi yet"** → curl one-liner; aba **"Already have Pi"** → `pi install npm:remote-pi` + `/remote-pi install`. A aba curl só **acende quando a Wave 0 existir**; "Already have Pi" entra já |
| 3 | **Promessa do Hero** | "Control all your agents from your phone — at once." (remote-control; pluralidade como substrato, não mesh-cêntrico) |
| 4 | **De-bloat da home** | **Moderado**: mantém Quick start (só curl) + 6 features + estrutura; encolhe Daemon mode pra teaser; consolida CTAs |
| 5 | **Tutoriais** | **Seção separada** (irmã de Docs no nav). Currículo: (1) Getting Started c/ App, (2) Mesh local, (3) Mesh remota, (4) Daemon how-to |
| 6 | **"Por que Pi"** | Página de **decisão** linkada do hero (vivo 24/7, leve, extensível). Comparação **auto-focada** com OpenClow/Hermes (só afirma propriedades do Pi). Daemon *how-to* fica no tutorial |
| 7 | **Doc** | Vira **Referência** enxuta; seções tutorial-flavored encolhem a 1 parágrafo + ponteiro "→ ver tutorial X" |
| 8 | **Curl installer** | **Não existe ainda** → pré-requisito (pi-extension). Aba "No Pi yet" (curl) só acende quando a Wave 0 rodar; aba "Already have Pi" entra já |
| 9 | **Substrato de conteúdo** | **JSX literal**, sem MDX (mantém Plano 22). Reusa `DocsSection`/`CodeBlock`; novos componentes compartilhados: abas de install, callout, prev/next |

### Revisão explícita do Plano 27 (Wave D)

Plano 27-D fixou a copy da home como *"mesh de agentes / seus terminais conversam
entre si; celular é só autenticador"*. **Este plano reverte conscientemente essa
direção**: o enquadramento mesh **sai do hero** e migra pros tutoriais de Mesh
local/remota. O hero passa a "controle todos os seus agentes pelo celular". Não é
mudança silenciosa — está registrada aqui; 27-D fica historicamente válido até a
Wave A deste plano aterrissar.

## Restrições inegociáveis

- **Inglês only** (Plano 22). Copy renderizada em inglês mesmo que a entrevista
  seja em PT. Hero EN: *"Control all your agents from your phone — at once."*
- **Sem afirmar E2E** (memory `project_no_e2e_yet`). O relay vê plaintext; o que
  existe é **TLS em trânsito + pairing Ed25519**. Copy diz "encrypted in transit",
  **nunca** "end-to-end". Crítico no tutorial de **Mesh remota**.
- **OpenClow/Hermes sempre tratados como excelentes**. A vantagem do Pi é
  enquadrada como **leve + extensível + vivo 24/7** ("você monta o seu, não vem
  inchado"), nunca como "os outros são ruins".
- **Sem screenshots no site** (memory `feedback_no_site_screenshots`). Verificação
  = `pnpm lint && pnpm build`. Sem verificação visual.
- **Site não promete o que não roda**: o `curl … | bash` só vira herói depois que
  a Wave 0 existir e for testada num ambiente limpo.
- **JSX literal** — decisão **mantida** (entrevista 2026-05-31), **sem MDX**.
  Reusar os primitivos existentes (`DocsSection`, `DocsSubsection`, `CodeBlock`) e
  criar os compartilhados que faltam: **abas de install**, **callout/heads-up** e
  **navegação prev/next** dos tutoriais. Consistente com o Plano 22.

## Estrutura esperada (site)

```
src/app/
  page.tsx                 # home (Wave A): hero novo, quick start curl, daemon teaser
  why/page.tsx             # NOVO (Wave B): "Por que Pi" — decisão + comparação
  tutorials/
    page.tsx               # NOVO (Wave C): índice da seção
    getting-started/…      # tutorial 1 (inclui App)
    mesh-local/…           # tutorial 2
    mesh-remote/…          # tutorial 3
    daemon/…               # tutorial 4 (how-to)
  docs/page.tsx            # Wave D: reduzida a Referência + ponteiros
  components/header.tsx    # nav ganha "Tutorials" ao lado de "Docs"
  install.sh (rota/estática)  # Wave 0 hospeda o one-liner sob o domínio do site
```

## Fases

**Dois panes, dois ritmos.** A **Wave 0** roda no pane **Extension** e corre **em
paralelo** com tudo — as Waves de site não dependem dela (usam a aba "Already have
Pi" desde já). As **Waves A–D rodam no mesmo pane Site**, logo são **seriais entre
si** — não há paralelismo dentro do site. A **Wave E** é o "merge" final: acende a
aba "No Pi yet" com o curl real; depende da Wave 0 **e** de a Wave A já existir.

**Ordem serial no Site** (cada uma encadeia na anterior por componentes/links):

| Ordem | Wave | Por que nessa posição | Bloqueio |
|---|---|---|---|
| 1º | **A** — home + componentes | Cria os compartilhados (abas, callout, prev/next, nav "Tutorials") que B/C reusam | — |
| 2º | **B** — "Por que Pi" | Pequena; resolve o link *why* do teaser da Wave A | **lastro**: confirmar OpenClow/Hermes |
| 3º | **C** — Tutoriais | Maior peça; resolve os links de tutorial do teaser (A) e os ponteiros da doc (D) | — |
| 4º | **D** — Doc→Referência | Os ponteiros "→ ver tutorial X" só resolvem com as rotas da Wave C no ar | depende de **C** |
| ⧖ | **E** — aba curl real | A qualquer momento após **A** **e** **Wave 0** fecharem | **Wave 0** |

> B e C podem trocar de ordem (B é pequena e independente de C); o resto é fixo.
> Links internos pra rotas ainda-não-criadas **não quebram o `build`** — ficam
> mortos só até a Wave que cria a rota aterrissar.

---

### Wave 0 — Curl installer (pi-extension) · pré-requisito

**Despachar pro pane `Extension`.** Script de bootstrap zero→rodando, invocável por
`curl -fsSL https://remote-pi.jacobmoura.work/install.sh | bash`.

Passos do script (**idempotente, sem `sudo` — tudo user-space**; detecta macOS/Linux):
1. **Node** — usa o do sistema se já houver ≥ versão mínima; senão instala via nvm
   em `~/` (sem root, sem pisar no Node do sistema)
2. Instala o **Pi** (CLI do agente). ⚠️ **Unknown**: o mecanismo de install do
   próprio Pi (npm? script? brew?) define este passo — o pane Extension resolve
3. Instala o **plugin remote-pi** (`pi install npm:remote-pi`)
4. **Linka a CLI** `remote-pi` em `~/.local/bin/`
5. Instala o **supervisor de usuário** (launchd GUI agent no macOS / `systemd
   --user` no Linux) — reuso do caminho de `/remote-pi install`
6. **Não pareia.** Imprime o próximo passo (parear o celular) e encerra

Decisões de implementação:
- **Hospedagem**: `install.sh` versionado no repo e servido pela rota estática do
  site (domínio canônico) → o site é dono do one-liner. Wave 0 entrega o script; a
  rota é plumbing trivial na Wave A/E.
- **OS** (decisão fechada): **macOS + Linux nativo**. **Windows → mensagem "use
  WSL"** (tratado como Linux), sem suporte nativo — não há launchd/systemd; Task
  Scheduler/Service fica pra plano futuro se houver demanda.
- **Versão**: instala a versão publicada **mais recente** do plugin e **imprime o
  que instalou**.
- **Trust**: zero `sudo`; documentar "leia antes de rodar" e expor o `.sh` legível
  (padrão nvm/rustup).

**DoD Wave 0**:
- [ ] One-liner num macOS limpo deixa um daemon Pi vivo respondendo o mesh, **sem
      pedir sudo**
- [ ] One-liner num Linux limpo idem (`systemd --user`), sem sudo
- [ ] Node já presente (≥ mínimo) é respeitado; ausente é instalado user-space
- [ ] Windows imprime "use WSL" e sai limpo (não tenta instalar)
- [ ] Segundo run é **no-op** idempotente (não duplica daemon/link)
- [ ] Falha clara e acionável quando pré-condição falta; script imprime o que instalou
- [ ] `pnpm test` + `pnpm typecheck` no pi-extension OK

---

### Wave A — Home de-bloat (site) · moderado

**Despachar pro pane `Site`.** Toca `src/app/page.tsx`, `src/components/hero.tsx`,
`src/components/header.tsx`.

- **Hero**: trocar a promessa mesh por **"Control all your agents from your phone
  — at once."** H1 "Remote Pi" mantém. Botão primário → Quick start. Botão
  secundário → GitHub. (Estrutura do hero preservada: logo, H1, 2 botões.)
- **Install (componente de abas, EN)**: substituir o Quick start atual por um
  bloco de **2 abas**:
  - **"No Pi yet"** → o one-liner `curl -fsSL https://remote-pi.jacobmoura.work/install.sh | bash`.
    **Acende só quando a Wave 0 aterrissar** — até lá, aba desabilitada com
    "Coming soon" (ou oculta).
  - **"Already have Pi"** → mostra **dois comandos**: `pi install npm:remote-pi`
    e `/remote-pi install`. O **pareamento** é descoberto no wizard que o
    `/remote-pi install` abre — não vira passo exibido. **Disponível desde já**
    (não depende da Wave 0).
  - O pane Site confirma contra a CLI real que `/remote-pi install` conduz ao
    pareamento; se não conduzir, expor `/remote-pi pair` como 3º comando.
  - Remove a duplicação de comandos que existe hoje (Quick start 3-step vs Daemon
    4-step).
- **Daemon mode**: **encolher** o bloco de 4 `DaemonStep` pra um **teaser de 1
  card** que linka `/why` (decisão) + `/tutorials/daemon` (how-to). Tirar o
  passo-a-passo da home.
- **Features**: manter as **6**, mas revisar a copy de "Mesh across machines" e
  "Works with the harness" pra não brigar com "plugin do Pi" (mesh = feature
  avançada, não manchete).
- **CTA**: consolidar os **2 CTAs de GitHub** em **1** no rodapé da página.
- **Header nav**: adicionar "Tutorials" (aponta pra `/tutorials`, criada na Wave C).

**DoD Wave A**:
- [ ] Hero com a promessa nova (EN), sem copy mesh-cêntrica
- [ ] Install em **abas** ("No Pi yet" / "Already have Pi"), não 2–3 blocos soltos
- [ ] Aba "No Pi yet" desabilitada/"Coming soon" enquanto a Wave 0 não fecha
- [ ] Daemon mode reduzido a teaser com 2 links (why + tutorial)
- [ ] 6 features preservadas, copy revisada; 1 CTA único
- [ ] `pnpm lint && pnpm build` OK

---

### Wave B — Página "Por que Pi" (site) · decisão

**Despachar pro pane `Site`.** Nova rota `src/app/why/page.tsx`, linkada do hero e
do teaser de daemon.

- Conteúdo de **decisão** (pré-install): Pi como **agente vivo 24/7**, **leve**,
  **extensível** (instala as skills/plugins que quiser — você monta o seu).
- **Comparação auto-focada** (formato fechado): a página **só afirma propriedades
  do Pi**; OpenClow/Hermes são citados como **all-in-one excelentes**, **sem
  afirmar os internals deles**. Comparativa no **tom** ("quer tudo-em-um pronto?
  eles são ótimos; quer leve e montável? Pi"), **não em tabela** de features.
- ⚠️ **Bloqueio de lastro**: antes de escrever, o usuário **confirma o que são
  OpenClow/Hermes** (nome/grafia corretos + 1 linha de posicionamento) pra não
  inventar. Com o formato auto-focado o risco é mínimo, mas os **nomes** precisam
  estar certos.
- **Sem E2E**; sem screenshots.

**DoD Wave B**:
- [ ] Rota `/why` no ar, linkada do hero + teaser de daemon
- [ ] Comparação **auto-focada**: zero afirmação sobre internals de OpenClow/Hermes
- [ ] Eles citados como excelentes; vantagem do Pi = leve/extensível/24-7
- [ ] Nomes/posicionamento de OpenClow/Hermes confirmados pelo usuário antes do texto
- [ ] Nenhuma afirmação de E2E
- [ ] `pnpm lint && pnpm build` OK

---

### Wave C — Seção Tutoriais (site) · 4 tutoriais

**Despachar pro pane `Site`.** Nova rota `src/app/tutorials/` + índice; irmã de
Docs no nav. **Substrato: JSX literal** (decisão fechada — sem MDX), reusando
`DocsSection`/`CodeBlock` e os componentes compartilhados (abas de install,
callout, prev/next) criados na Wave A.

1. **Getting Started** (inclui o App): install (curl quando pronto / in-Pi
   interino) → pair → **primeiro comando do celular**. É o âncora; não esquecer o
   lado do App.
2. **Mesh local**: como os agentes se enxergam e conversam no broker local
   (`list_peers`, `agent_send`).
3. **Mesh remota**: roteamento cross-PC via relay. Copy "encrypted in transit",
   **nunca** E2E. Mencionar que "Delivered" = broker aceitou, não "peer vivo"
   (memory `project_mesh_delivered_not_alive`).
4. **Daemon (how-to)**: supervisor, `remote-pi create`, manter vivo 24/7, fleet
   ops. O *por que* mora em `/why`, não aqui.

**DoD Wave C**:
- [ ] Nav header com "Tutorials" ao lado de "Docs"
- [ ] 4 tutoriais navegáveis, cada um mão-na-massa (passos executáveis)
- [ ] Mesh remota sem claim de E2E; nuance de "Delivered" presente
- [ ] Daemon tutorial é só *how*; *why* linka pra `/why`
- [ ] `pnpm lint && pnpm build` OK

---

### Wave D — Doc → Referência (site) · refactor

**Despachar pro pane `Site`.** Refactor de `src/app/docs/page.tsx` (1273 linhas).

- **Encolher pra ponteiro** as seções tutorial-flavored: Quick start, What it does,
  Install, Using /remote-pi, Pairing, Quick actions, Agent network (deeper look),
  Daemon mode walkthrough → cada uma vira 1 parágrafo + "→ See the X tutorial".
- **Manter como referência**: The relay (self-host), Protocol & Security, Command
  reference, Configuration files, Troubleshooting, Links.
- Resultado: doc deixa de duplicar os tutoriais e cai de ~1273 linhas pra uma
  referência enxuta.

**DoD Wave D**:
- [ ] Seções de aprendizado reduzidas a parágrafo + ponteiro pro tutorial
- [ ] Referência preservada (relay/protocol/commands/config/troubleshooting/links)
- [ ] Zero walkthrough duplicado entre Docs e Tutoriais
- [ ] `pnpm lint && pnpm build` OK

---

### Wave E — Acender a aba "No Pi yet" com o curl real (site) · gated na Wave 0

**Despachar pro pane `Site`** depois que a Wave 0 fechar e o one-liner for testado.

- Rota estática `install.sh` servida sob o domínio do site (recebe o script da
  Wave 0).
- A aba **"No Pi yet"** sai de "Coming soon" e passa a mostrar o **curl real**
  testado. A aba "Already have Pi" segue inalterada.

**DoD Wave E**:
- [ ] `install.sh` acessível sob o domínio canônico
- [ ] Aba "No Pi yet" mostra o curl real (testado num ambiente limpo)
- [ ] Aba "Already have Pi" segue funcionando (sem regressão)
- [ ] `pnpm lint && pnpm build` OK

---

## DoD consolidado

- [ ] Wave 0 — curl installer entregue e testado (pi-extension)
- [ ] Wave A — home de-bloat (hero novo, 1 walkthrough, daemon teaser, 1 CTA)
- [ ] Wave B — página `/why` (decisão + comparação respeitosa)
- [ ] Wave C — seção Tutoriais com os 4 tutoriais
- [ ] Wave D — Doc reduzida a Referência + ponteiros
- [ ] Wave E — hero promove o curl real (gated na Wave 0)
- [ ] Memory atualizada: `project_pre_publish_cycle` (27-D revisado) e nota da
      virada de posicionamento mesh→remote-control

## Próximos planos

- **i18n PT-BR** dos tutoriais/doc, se vier demanda (Plano 22 é EN-only).
- **Wrappers de harness** (Plano 27 Wave B): tutorial "Pi como gateway de um
  agente não-Pi (OpenClow/Hermes)" quando o wrapper de Claude Code/OpenCode
  existir — é o conteúdo avançado que saiu do hero hoje.
- **Tutoriais de receita** (casos de uso: revisar PR do celular, rodar testes
  remotos) conforme a seção amadurece.
