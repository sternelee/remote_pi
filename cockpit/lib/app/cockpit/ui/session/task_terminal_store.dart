import 'dart:async';
import 'dart:convert';

import 'package:cockpit/app/cockpit/domain/contracts/task_runner_gateway.dart';
import 'package:cockpit/app/cockpit/domain/entities/task_run.dart';
import 'package:xterm/xterm.dart';

/// Mantém **um emulador [Terminal] por task**, alimentado continuamente pelo
/// output do runner — independente de haver ou não uma aba aberta. É isso que
/// preserva o estado: a aba de visualização ([TaskOutputSession]) só renderiza
/// o terminal que vive aqui; fechá-la não perde o buffer, e o runner segue.
///
/// App-scoped (bind no `cockpit_module`); criado já no mount da `CockpitViewModel`
/// (que o injeta), então escuta desde o boot.
class TaskTerminalStore {
  TaskTerminalStore(this._runner) {
    _sub = _runner.runs().listen(_onRun);
  }

  final TaskRunnerGateway _runner;
  StreamSubscription<TaskRun>? _sub;

  final _terminals = <String, Terminal>{};
  final _outSubs = <String, StreamSubscription<String>>{};
  final _lastPid = <String, int?>{};

  /// Terminal da task (cria um vazio na primeira vez — read-only na UI). O
  /// `onResize` é ligado ao pty pra o output refluir ao tamanho do viewer.
  Terminal terminalFor(String taskId) => _terminals.putIfAbsent(taskId, () {
    final term = Terminal(maxLines: 10000);
    term.onResize = (w, h, pw, ph) => _runner.resize(taskId, h, w);
    return term;
  });

  void _onRun(TaskRun run) {
    if (!run.isActive) return;
    // Só (re)liga quando é um run NOVO (pid mudou) — building↔running do mesmo
    // processo não re-subscreve.
    if (_lastPid[run.taskId] == run.pid) return;
    _lastPid[run.taskId] = run.pid;

    final term = terminalFor(run.taskId);
    // Restart (já houve run): limpa tela + scrollback e volta o cursor ao topo
    // — o novo run começa do zero (mesma sequência do comando `clear`).
    if (_outSubs.containsKey(run.taskId)) {
      term.write('\x1b[H\x1b[2J\x1b[3J');
    }
    _outSubs.remove(run.taskId)?.cancel();
    _outSubs[run.taskId] = _runner
        .output(run.taskId)
        .cast<List<int>>()
        .transform(const Utf8Decoder(allowMalformed: true))
        .listen(term.write);
  }

  void dispose() {
    _sub?.cancel();
    for (final s in _outSubs.values) {
      s.cancel();
    }
    _outSubs.clear();
    _terminals.clear();
  }
}
