import 'package:cockpit/app/cockpit/ui/session/pane_item.dart';
import 'package:xterm/xterm.dart';

/// Aba **read-only** que visualiza o output de uma task. É leve e descartável:
/// o [terminal] não é dela — vive no `TaskTerminalStore` —, então abrir/fechar
/// a aba não perde o buffer nem mexe na task. Não persiste entre reinícios do
/// app (a task morre junto); o restore a descarta via `_sanitizeTree`.
class TaskOutputSession extends PaneItem {
  TaskOutputSession({
    required this.id,
    required this.projectId,
    required this.taskId,
    required String label,
    required this.terminal,
    required this.workingDirectory,
  }) : _label = label;

  @override
  final String id;
  @override
  final String projectId;

  /// Id da [TaskDefinition] cujo output esta aba espelha.
  final String taskId;

  /// Terminal compartilhado (dono = `TaskTerminalStore`). **Não** dar dispose.
  final Terminal terminal;

  final String _label;

  @override
  final String workingDirectory;

  @override
  String get title => '▶ $_label';
}
