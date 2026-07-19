import 'package:cockpit/app/cockpit/domain/entities/db_connection.dart';
import 'package:cockpit/app/cockpit/ui/viewmodels/database_viewmodel.dart';
import 'package:cockpit/app/cockpit/ui/widgets/db_connection_dialog.dart';
import 'package:cockpit/app/core/ui/themes/themes.dart';
import 'package:cockpit/app/core/ui/widgets/app_menu.dart';
import 'package:cockpit/app/core/ui/widgets/hover_tap.dart';
import 'package:flutter_modular/flutter_modular.dart';
import 'package:shadcn_flutter/shadcn_flutter.dart';

/// Corpo da aba **Database** do painel direito (plano 51, decisão E): conexões
/// do workspace — registradas (`.cockpit/databases.json`), locais e sqlites
/// detectados. "+" abre o popup de engine → dialog; clicar numa conexão edita
/// (o mesmo dialog).
class DbPanel extends StatefulWidget {
  const DbPanel({
    super.key,
    required this.workspaceId,
    required this.workspaceRoot,
  });

  final String workspaceId;
  final String workspaceRoot;

  @override
  State<DbPanel> createState() => _DbPanelState();
}

class _DbPanelState extends State<DbPanel> {
  @override
  void initState() {
    super.initState();
    _syncWorkspace();
  }

  @override
  void didUpdateWidget(DbPanel old) {
    super.didUpdateWidget(old);
    if (old.workspaceId != widget.workspaceId ||
        old.workspaceRoot != widget.workspaceRoot) {
      _syncWorkspace();
    }
  }

  void _syncWorkspace() {
    // Fora do build: setWorkspace notifica listeners ao terminar o load.
    final vm = context.read<DatabaseViewModel>();
    Future.microtask(
      () => vm.setWorkspace(
        widget.workspaceId,
        widget.workspaceRoot,
        force: true,
      ),
    );
  }

  Future<void> _add(BuildContext anchor) async {
    final vm = context.read<DatabaseViewModel>();
    final engine = await showAppMenu<DbEngine>(
      anchor,
      items: [
        for (final e in DbEngine.values)
          AppMenuItem(value: e, label: e.label, icon: Icons.storage),
      ],
    );
    if (engine == null || !mounted) return;
    final result = await showDialog<DbConnectionDialogResult>(
      context: context,
      builder: (context) => DbConnectionDialog(engine: engine, viewModel: vm),
    );
    if (result?.connection == null) return;
    await vm.upsert(result!.connection!, password: result.password);
  }

  Future<void> _edit(DbConnection conn) async {
    final vm = context.read<DatabaseViewModel>();
    final result = await showDialog<DbConnectionDialogResult>(
      context: context,
      builder: (context) =>
          DbConnectionDialog(engine: conn.engine, viewModel: vm, initial: conn),
    );
    if (result == null) return;
    if (result.deleted) {
      if (conn.origin == DbConnectionOrigin.registered) {
        await vm.remove(conn);
      }
      return;
    }
    if (result.connection != null) {
      // Editar uma "detected"/"local" salva como registrada (promoção).
      await vm.upsert(
        result.connection!,
        password: result.password,
        previousName: conn.name,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final typo = context.typo;
    final vm = context.watch<DatabaseViewModel>();
    final conns = vm.connections;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 6, 4),
          child: Row(
            children: [
              Text(
                'DATABASE',
                style: typo.label.copyWith(
                  fontSize: 10,
                  letterSpacing: 1.1,
                  color: colors.text3,
                ),
              ),
              const Spacer(),
              HoverTap(
                onTap: () => context.read<DatabaseViewModel>().reload(),
                padding: const EdgeInsets.all(3),
                child: Icon(Icons.refresh, size: 14, color: colors.text3),
              ),
              const SizedBox(width: 2),
              Builder(
                builder: (anchor) => HoverTap(
                  onTap: () => _add(anchor),
                  padding: const EdgeInsets.all(3),
                  child: Icon(Icons.add, size: 14, color: colors.text3),
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: conns.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'No connections yet.',
                    style: typo.label.copyWith(
                      fontSize: 11.5,
                      color: colors.text3,
                      height: 1.5,
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  itemCount: conns.length,
                  itemBuilder: (context, i) =>
                      _ConnectionRow(conn: conns[i], onTap: _edit),
                ),
        ),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: colors.border)),
          ),
          child: Text(
            '.cockpit/databases.json · ${conns.length} '
            'connection${conns.length == 1 ? '' : 's'}',
            style: typo.label.copyWith(fontSize: 10.5, color: colors.text4),
          ),
        ),
      ],
    );
  }
}

class _ConnectionRow extends StatelessWidget {
  const _ConnectionRow({required this.conn, required this.onTap});

  final DbConnection conn;
  final void Function(DbConnection) onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final typo = context.typo;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 1),
      child: HoverTap(
        onTap: () => onTap(conn),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(Icons.storage, size: 12, color: colors.text4),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          conn.name,
                          overflow: TextOverflow.ellipsis,
                          style: typo.body.copyWith(
                            fontSize: 12.5,
                            color: colors.text2,
                          ),
                        ),
                      ),
                      if (conn.origin == DbConnectionOrigin.detected) ...[
                        const SizedBox(width: 6),
                        const _Chip('detected'),
                      ],
                      if (conn.origin == DbConnectionOrigin.local) ...[
                        const SizedBox(width: 6),
                        const _Chip('local'),
                      ],
                    ],
                  ),
                  Text(
                    '${conn.engine.label} · ${conn.displayTarget}',
                    overflow: TextOverflow.ellipsis,
                    style: typo.mono.copyWith(
                      fontSize: 10,
                      color: colors.text4,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip(this.label);
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        border: Border.all(color: colors.border2),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        label,
        style: context.typo.label.copyWith(fontSize: 9.5, color: colors.text3),
      ),
    );
  }
}
