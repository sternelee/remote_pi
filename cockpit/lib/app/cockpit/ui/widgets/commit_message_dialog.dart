import 'package:cockpit/app/core/ui/themes/themes.dart';
import 'package:shadcn_flutter/shadcn_flutter.dart';

/// Dialog de mensagem de commit (Source Control → "Commit"/"Stage and Commit").
///
/// Valida ao vivo, seguindo as convenções de commit do git:
/// - **subject** (1ª linha): obrigatório, 3–72 caracteres, sem terminar em "."
///   e sem caracteres de controle; contador `n/72` ao vivo;
/// - **corpo** opcional: se existir, a 2ª linha deve ficar em branco
///   (separador subject/corpo do git).
///
/// Ao confirmar, trava com spinner e chama [onCommit] (que roda o
/// `git commit` real): mensagem de erro → mostra inline; `null` → fecha.
Future<void> showCommitMessageDialog(
  BuildContext context, {
  required String fileName,
  required bool staged,
  required Future<String?> Function(String message) onCommit,
}) {
  return showDialog<void>(
    context: context,
    barrierColor: const Color(0x99000000),
    builder: (context) => _CommitMessageDialog(
      fileName: fileName,
      staged: staged,
      onCommit: onCommit,
    ),
  );
}

class _CommitMessageDialog extends StatefulWidget {
  const _CommitMessageDialog({
    required this.fileName,
    required this.staged,
    required this.onCommit,
  });

  final String fileName;
  final bool staged;
  final Future<String?> Function(String message) onCommit;

  @override
  State<_CommitMessageDialog> createState() => _CommitMessageDialogState();
}

class _CommitMessageDialogState extends State<_CommitMessageDialog> {
  static const int _subjectMax = 72;
  static const int _subjectMin = 3;

  final TextEditingController _message = TextEditingController();
  bool _submitting = false;
  String? _gitError;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  String get _subject {
    final text = _message.text;
    final nl = text.indexOf('\n');
    return (nl < 0 ? text : text.substring(0, nl)).trim();
  }

  /// Regras da mensagem — `null` = válida (ou campo ainda intacto).
  String? get _reason {
    final text = _message.text;
    if (text.isEmpty) return null; // intacto: sem erro, botão desabilitado
    final subject = _subject;
    if (subject.isEmpty) return 'The first line (subject) cannot be empty.';
    if (subject.length < _subjectMin) {
      return 'Subject too short (min $_subjectMin characters).';
    }
    if (subject.length > _subjectMax) {
      return 'Subject too long (max $_subjectMax characters).';
    }
    if (subject.endsWith('.')) {
      return 'Subject should not end with a period.';
    }
    if (subject.codeUnits.any((c) => c < 0x20)) {
      return 'Subject contains control characters.';
    }
    final lines = text.split('\n');
    if (lines.length > 1 && lines[1].trim().isNotEmpty) {
      return 'Leave the second line blank (git subject/body separator).';
    }
    return null;
  }

  bool get _canCommit =>
      _message.text.trim().isNotEmpty && _reason == null && !_submitting;

  Future<void> _submit() async {
    if (!_canCommit) return;
    setState(() {
      _submitting = true;
      _gitError = null;
    });
    final error = await widget.onCommit(_message.text.trim());
    if (!mounted) return;
    if (error == null) {
      Navigator.of(context).pop();
      return;
    }
    setState(() {
      _submitting = false;
      _gitError = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final reason = _gitError ?? _reason;
    final showError = reason != null;
    final count = _subject.length;

    return AlertDialog(
      title: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.staged ? 'Commit' : 'Stage and Commit',
            style: context.typo.title.copyWith(
              fontSize: 15,
              color: colors.text,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Commit "${widget.fileName}" only.',
            style: context.typo.label.copyWith(color: colors.text3),
          ),
        ],
      ),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _message,
              autofocus: true,
              enabled: !_submitting,
              maxLines: 4,
              onChanged: (_) => setState(() => _gitError = null),
              placeholder: const Text('fix: short summary of the change'),
              style: context.typo.mono.copyWith(
                fontSize: 13,
                color: colors.text,
              ),
              borderRadius: BorderRadius.circular(7),
              border: showError ? Border.all(color: colors.error) : null,
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                if (showError)
                  Expanded(
                    child: Text(
                      reason,
                      style: context.typo.label.copyWith(color: colors.error),
                    ),
                  )
                else
                  const Spacer(),
                Text(
                  '$count/$_subjectMax',
                  style: context.typo.label.copyWith(
                    fontSize: 11,
                    color: count > _subjectMax ? colors.error : colors.text4,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        OutlineButton(
          onPressed: _submitting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        PrimaryButton(
          onPressed: _canCommit ? _submit : null,
          child: _submitting
              ? const CircularProgressIndicator(size: 16, color: Colors.white)
              : const Text('Commit'),
        ),
      ],
    );
  }
}
