import 'dart:async';

import 'package:cockpit/app/cockpit/domain/contracts/task_discovery.dart';
import 'package:cockpit/app/cockpit/domain/contracts/task_runner_gateway.dart';
import 'package:cockpit/app/cockpit/domain/entities/task_definition.dart';
import 'package:cockpit/app/cockpit/domain/entities/task_run.dart';
import 'package:flutter/foundation.dart';

/// ViewModel page-scoped do subpane de Tasks. Descobre as tasks do projeto
/// selecionado e dirige o ciclo de vida via [TaskRunnerGateway], refletindo o
/// stream de estados vivos. A `ui/` nunca toca `data/` direto.
class TasksViewModel extends ChangeNotifier {
  TasksViewModel(this._discovery, this._runner) {
    _sub = _runner.runs().listen(_onRun);
  }

  final TaskDiscovery _discovery;
  final TaskRunnerGateway _runner;
  StreamSubscription<TaskRun>? _sub;

  String _cwd = '';
  List<TaskDefinition> _tasks = const [];
  bool _loading = false;
  final _states = <String, TaskRun>{};
  // Toggle do "reload ao salvar" por task (default on). Persiste só em memória.
  final _watchOn = <String, bool>{};
  // Profile escolhido por task (default = primeiro). Persiste só em memória.
  final _profile = <String, String>{};
  // Args ad-hoc por task (override de UMA execução). Persiste só em memória.
  final _adHoc = <String, String>{};

  List<TaskDefinition> get tasks => _tasks;
  bool get loading => _loading;

  /// Estado atual de uma task (idle se nunca rodou).
  TaskRun stateOf(String taskId) =>
      _states[taskId] ?? _runner.runOf(taskId);

  /// `true` se a task tem watcher configurado (mostra o toggle "reload ao salvar").
  bool watchSupported(TaskDefinition def) => def.watch != null;

  /// Estado do toggle (default on quando há watcher).
  bool watchOn(String taskId) => _watchOn[taskId] ?? true;

  /// Liga/desliga o "reload ao salvar"; aplica na hora se a task está viva.
  void toggleWatch(TaskDefinition def) {
    final next = !watchOn(def.id);
    _watchOn[def.id] = next;
    if (stateOf(def.id).isActive) {
      next ? _runner.startWatch(def) : _runner.stopWatch(def.id);
    }
    notifyListeners();
  }

  /// (Re)carrega as tasks do projeto em [cwd]. No-op se já é o cwd corrente.
  Future<void> loadFor(String cwd) async {
    if (cwd == _cwd) return;
    _cwd = cwd;
    _tasks = const [];
    _loading = true;
    notifyListeners();
    final found = cwd.isEmpty
        ? const <TaskDefinition>[]
        : await _discovery.discover(cwd);
    if (cwd != _cwd) return; // corrida com outra troca de projeto
    _tasks = found;
    _loading = false;
    notifyListeners();
  }

  /// Nome do profile selecionado (default = primeiro; null se a task não tem).
  String? selectedProfile(TaskDefinition def) {
    if (def.profiles.isEmpty) return null;
    return _profile[def.id] ?? def.profiles.first.name;
  }

  /// Avança pro próximo profile (cicla). No-op com < 2 profiles.
  void cycleProfile(TaskDefinition def) {
    if (def.profiles.length < 2) return;
    final names = def.profiles.map((p) => p.name).toList();
    final cur = selectedProfile(def);
    final next = names[(names.indexOf(cur ?? names.first) + 1) % names.length];
    _profile[def.id] = next;
    notifyListeners();
  }

  /// Args ad-hoc (texto cru) de uma task.
  String adHocArgs(String taskId) => _adHoc[taskId] ?? '';

  /// Edita os args ad-hoc (override de uma execução, não vira profile).
  void setAdHocArgs(String taskId, String value) {
    _adHoc[taskId] = value;
    notifyListeners();
  }

  /// Comando final (preview) com profile + args ad-hoc aplicados.
  String commandPreview(TaskDefinition def) {
    final name = selectedProfile(def);
    final profile = name == null
        ? null
        : def.profiles.firstWhere((p) => p.name == name);
    final parts = [...def.resolveArgs(profile), ..._splitArgs(def.id)];
    return '${def.command} ${parts.join(' ')}'.trim();
  }

  Future<void> start(TaskDefinition def) => _runner.start(
    def,
    profileName: selectedProfile(def),
    adHocArgs: _splitArgs(def.id),
  );

  /// Quebra o texto ad-hoc em args por espaço (simples; sem aspas). Vazio = [].
  List<String> _splitArgs(String taskId) {
    final raw = (_adHoc[taskId] ?? '').trim();
    return raw.isEmpty ? const [] : raw.split(RegExp(r'\s+'));
  }

  Future<void> stop(String taskId) => _runner.stop(taskId);

  Future<void> restart(String taskId) => _runner.restart(taskId);

  void sendKey(String taskId, String key) => _runner.sendKey(taskId, key);

  void resize(String taskId, int rows, int columns) =>
      _runner.resize(taskId, rows, columns);

  /// Bytes do output de uma task (pra um terminal embutido — passo futuro).
  Stream<List<int>> output(String taskId) => _runner.output(taskId);

  void _onRun(TaskRun run) {
    _states[run.taskId] = run;
    // Arma/desarma o watcher conforme o ciclo de vida (idempotente no runner).
    if (run.isActive && watchOn(run.taskId)) {
      final def = _defOf(run.taskId);
      if (def != null) _runner.startWatch(def);
    } else if (!run.isActive) {
      _runner.stopWatch(run.taskId);
    }
    notifyListeners();
  }

  TaskDefinition? _defOf(String taskId) {
    for (final d in _tasks) {
      if (d.id == taskId) return d;
    }
    return null;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
