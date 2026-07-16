# Plano 50 — Cockpit Terminal Profiles (padrão + WSL/PowerShell/cmd + login shell)

> Subprojeto alvo: **`cockpit/`** (Flutter Desktop). Local-only, sem relay.
> Referência: PTY em `cockpit/lib/app/cockpit/data/terminal/pty_terminal_gateway.dart`,
> resolução de shell POSIX em `cockpit/lib/app/core/utils/login_shell.dart`
> (feito na issue #42), convenções de feature vertical em `cockpit/lib/app/CLAUDE.md`.
> Fecha a **issue #50** (suporte a WSL2 no Windows) generalizando o problema.

## Contexto

Hoje o shell do terminal é **hardcoded** por plataforma em
`PtyTerminalGateway._shell()`:

- Windows: `powershell.exe` (ou `cmd.exe` no ARM).
- POSIX: login shell real do usuário (via `login_shell.dart`, issue #42).

Não há como o usuário **escolher** qual terminal abrir. Isso gera dois pedidos:

- **#50** — usuários de Windows querem **WSL2** (e, por tabela, escolher entre
  PowerShell/cmd/WSL).
- UX geral — ter um **padrão configurável** e um jeito rápido de abrir um
  terminal específico numa aba sem trocar a config global.

A decisão de produto (conversa com o usuário): **não** tratar "WSL2" como um
recurso especial de conexão. Modelar tudo como **perfis de terminal** — WSL,
PowerShell, cmd, login shell POSIX, custom são todos "perfis". Assim #50 vira só
"rode `wsl.exe` como shell do PTY", e o trabalho da #42 (login shell) vira o
"perfil padrão POSIX" do mesmo sistema.

## Princípio de design (regra de ouro)

**O gateway de PTY não sabe o que é "WSL" ou "PowerShell" — sabe só
`{ executable, args[], env{} }`.** Toda a lógica de descoberta/rotulagem de
perfis mora numa camada à parte (`TerminalProfile` + um enumerador por
plataforma). Mesma filosofia do plano 48 (core genérico, específico na borda) e
do `login_shell.dart`.

## Modelo de domínio

Nova feature (pode morar em `cockpit/lib/app/cockpit/` junto do terminal, ou
numa subpasta `terminal/profiles/`). Sugestão de entities:

```dart
/// Um perfil = como abrir um terminal. Genérico; sem conhecimento de stack.
class TerminalProfile {
  final String id;          // estável: 'powershell', 'cmd', 'wsl:Ubuntu', 'login-shell', 'custom:<uuid>'
  final String label;       // exibição: 'PowerShell', 'Ubuntu (WSL)', 'zsh (login)'
  final String executable;  // 'powershell.exe' | 'wsl.exe' | '/bin/zsh' | ...
  final List<String> args;  // ['-d','Ubuntu'] | ['-l'] | ...
  final bool builtIn;       // detectado (não editável) vs custom (editável)
  final String? iconKey;    // opcional, pro dropdown
}
```

- **`id` estável** é o que a config (Hive) guarda como "padrão". Nunca guardar o
  objeto inteiro — perfis são re-descobertos a cada boot; a config referencia por
  `id`.
- Perfis **builtIn** não são editáveis; **custom** sim (fatia 4, opcional).

## Descoberta de perfis (por plataforma)

Um `TerminalProfileResolver` que devolve a lista disponível:

- **Windows:**
  - `PowerShell` → `powershell.exe` (fallback pra `pwsh.exe` se existir).
  - `cmd` → `cmd.exe` (ou `%ComSpec%`).
  - **WSL distros** → `wsl.exe -l -q` (UTF-16LE! decodificar certo — pegadinha
    conhecida) → um perfil por distro: `wsl.exe -d <distro>`. Se `wsl.exe` não
    existe ou lista vazia, simplesmente não há perfil WSL (sem erro).
- **POSIX (macOS/Linux):**
  - `login shell` → reusa `resolveLoginShell()` (issue #42) com args `['-l']`.
  - (opcional) bash/zsh/fish detectados no PATH como perfis alternativos.

Descoberta é **best-effort e cacheável** (mesma vida de processo), timeout curto,
nunca lança — igual `login_shell.dart`.

## Config (Hive)

- Chave `terminal.default_profile_id` (String?) no store de settings existente.
- Resolução do padrão efetivo:
  1. Se `default_profile_id` está setado **e** o perfil ainda existe na
     descoberta → usa ele.
  2. Senão → fallback por plataforma: Windows = PowerShell; POSIX = login shell.
     (Preserva 100% o comportamento atual pra quem nunca mexeu na config.)
- **Migração:** ausência da chave = comportamento atual. Nada quebra.

## UX

### `+` com split-button (decisão de produto)

**Não** abrir modal bloqueante a cada `+`. Em vez disso:

- Clique no **`+`** → abre o **perfil padrão** direto (caminho rápido, caso 95%).
- Um **caret/dropdown** colado no `+` lista os perfis + "Configurar perfis…":

```
┌──────────┐
│  +  ▾     │   clique no "+"  = perfil padrão
└──┬───────┘
   └▾:
      • PowerShell   (padrão)   ← marca o padrão atual
      • cmd
      • Ubuntu (WSL)
      • Debian (WSL)
      ──────────────
      ⚙ Configurar perfis…      → abre Settings → Terminal
```

- Escolher um item do dropdown abre **aquela aba** com aquele perfil, sem mudar
  o padrão global.

### Settings → Terminal

- Selecionar o **perfil padrão** (dropdown com os perfis descobertos).
- (Fatia 4, opcional) CRUD de perfis **custom** (`label`, `executable`, `args`).

## Toque no código (mínimo)

- `PtyTerminalGateway.start(...)` passa a aceitar um `TerminalProfile` (ou
  `executable`+`args`) em vez de resolver o shell internamente. O `_shell()`/
  `_shellArgs()` atuais viram o **perfil padrão** montado pelo resolver.
- Windows: o branch atual (`powershell`/`cmd`/`ComSpec`) migra pro resolver.
- POSIX: o perfil login-shell reusa `login_shell.dart` — **sem regressão** do #42.
- Quem cria abas de terminal (o `+`) passa a resolver o perfil (padrão ou o
  escolhido no dropdown) e injeta no gateway.
- `env` (`TERM`/`COLORTERM`/truecolor) permanece como está.

## Fatias (waves)

1. **Domínio + descoberta + padrão configurável (headless).**
   `TerminalProfile`, `TerminalProfileResolver` (Win: PowerShell/cmd/WSL via
   `wsl.exe -l -q`; POSIX: login shell), config Hive `default_profile_id`,
   gateway recebe perfil. `+` abre o **padrão** (ainda sem dropdown).
   *Aceite:* num Windows com WSL, o resolver lista as distros; trocar
   `default_profile_id` (mesmo que via teste) muda o shell aberto; POSIX segue
   no login shell. `flutter analyze` limpo + testes de unidade do resolver
   (mockando `wsl.exe -l -q`, ausência de WSL, fallback).

2. **Settings → Terminal (perfil padrão).**
   Dropdown na tela de Configurações lista os perfis descobertos e persiste o
   `default_profile_id`. *Aceite:* selecionar e reabrir o app mantém o padrão;
   perfil que sumiu (ex.: distro removida) degrada pro fallback sem crash.

3. **`+` split-button/dropdown.**
   Caret ao lado do `+` com a lista de perfis + "Configurar perfis…"; abrir um
   item cria a aba com aquele perfil sem mudar o padrão. *Aceite:* abrir
   PowerShell e Ubuntu(WSL) em abas distintas no mesmo boot; o `+` puro segue
   abrindo o padrão.

4. **(Opcional) Perfis custom.**
   CRUD de perfis definidos pelo usuário (`label`/`executable`/`args`) em
   Settings. *Aceite:* criar um perfil "Git Bash" apontando pro `bash.exe` do
   Git e abri-lo pelo dropdown.

## Definition of Done

- [ ] Fatia 1: resolver + descoberta (incl. WSL via `wsl.exe -l -q`) + padrão
      configurável via Hive; gateway recebe perfil; login shell POSIX preservado.
- [ ] Fatia 2: Settings → Terminal seleciona/persiste o perfil padrão.
- [ ] Fatia 3: `+` com split-button abre perfil por aba sem mudar o padrão.
- [ ] `flutter analyze --no-pub` limpo e testes de unidade do resolver verdes.
- [ ] Windows: PowerShell, cmd e ao menos uma distro WSL abrem como terminais
      nativos (valida a #50). *(Requer E2E numa máquina Windows — pode ficar
      como último gate, igual à #49.)*
- [ ] Issue #50 referenciada/fechada quando as fatias 1–3 + E2E Windows fecharem.

## Notas / pegadinhas

- **`wsl.exe -l -q` sai em UTF-16LE** — decodificar com o encoding certo, senão a
  lista vem com `\x00` no meio e nenhum perfil casa.
- **POSIX sem regressão:** o perfil padrão POSIX **é** o login shell do #42; não
  reintroduzir o `$SHELL ?? '/bin/zsh'` antigo.
- **Fallback sempre seguro:** perfil ausente/inválido → cai no padrão de
  plataforma; nunca bloquear a abertura do terminal.
- **E2E Windows** (abrir WSL de fato) é o único passo que precisa de máquina
  Windows — alinhado com a decisão da #49 de deixar validação Windows pra quando
  houver o ambiente.

## Próximos planos

- Perfis por-workspace (um projeto abre WSL por padrão, outro PowerShell).
- Ícones/temas por perfil no `CockpitTerminal`.
