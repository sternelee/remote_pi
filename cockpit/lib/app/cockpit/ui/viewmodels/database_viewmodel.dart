import 'package:cockpit/app/cockpit/domain/services/db_query_service.dart';
import 'package:cockpit/app/cockpit/domain/contracts/db_connection_store.dart';
import 'package:cockpit/app/cockpit/domain/contracts/db_driver.dart';
import 'package:cockpit/app/cockpit/domain/entities/db_connection.dart';
import 'package:cockpit/app/cockpit/domain/entities/db_result.dart';
import 'package:flutter/foundation.dart';

/// Estado de VISUALIZAÇÃO de uma tab `.dbq` que precisa sobreviver ao
/// re-mount do widget (mover a tab pra outra pane destrói o State — mesma
/// razão do Terminal viver na session). Mutável; o widget lê/escreve direto.
class DbTabViewState {
  DbResult? result;
  DbQueryException? error;
  double split = 0.5;
  List<double> baseWidths = const [];
  List<double>? manualWidths;
  int? selectedRow;

  /// Resultado exibido como JSON (selecionável/copiável) em vez de tabela.
  /// Só estado de view — não vai pro frontmatter do `.dbq`.
  bool asJson = false;
}

/// Estado do painel Database + serviço de execução pras tabs `.dbq` (plano
/// 51). Page-scoped (provido no `cockpit_module`); o workspace ativo entra
/// via [setWorkspace] (chamado pelo painel quando o projeto muda).
class DatabaseViewModel extends ChangeNotifier {
  DatabaseViewModel(this._store, this._secrets, this._registry, this.service);

  final DbConnectionStore _store;
  final DbSecrets _secrets;
  final DbDriverRegistry _registry;

  /// Motor compartilhado tab/CLI — exposto pras tabs `.dbq` executarem.
  final DbQueryService service;

  String? _workspaceId;
  String? _workspaceRoot;
  List<DbConnection> _connections = const [];
  bool _disposed = false;

  List<DbConnection> get connections => _connections;
  String? get workspaceRoot => _workspaceRoot;

  /// Side-car de estado de view por tab `.dbq` (chave = session id). Cap
  /// simples por inserção — tab fechada some do mapa quando ele gira.
  final _tabStates = <String, DbTabViewState>{};
  static const _maxTabStates = 24;

  DbTabViewState tabStateFor(String sessionId) {
    final existing = _tabStates.remove(sessionId);
    if (existing != null) {
      _tabStates[sessionId] = existing; // re-insere no fim (LRU barato)
      return existing;
    }
    final fresh = DbTabViewState();
    _tabStates[sessionId] = fresh;
    if (_tabStates.length > _maxTabStates) {
      _tabStates.remove(_tabStates.keys.first);
    }
    return fresh;
  }

  /// Aponta pro workspace ativo; recarrega quando muda (ou em [force]).
  Future<void> setWorkspace(String id, String root, {bool force = false}) {
    if (!force && id == _workspaceId && root == _workspaceRoot) {
      return Future.value();
    }
    _workspaceId = id;
    _workspaceRoot = root;
    return reload();
  }

  Future<void> reload() async {
    final root = _workspaceRoot;
    if (root == null) return;
    final loaded = await _store.load(root);
    if (_disposed || root != _workspaceRoot) return;
    _connections = loaded;
    notifyListeners();
  }

  /// Cria/atualiza uma conexão registrada. [previousName] identifica a antiga
  /// num rename; [password] só é gravado no cofre quando `savePassword` (e
  /// removido quando o flag desliga). Editar uma "detected" a promove a
  /// registrada.
  Future<void> upsert(
    DbConnection conn, {
    String? password,
    String? previousName,
  }) async {
    final root = _workspaceRoot;
    final wsId = _workspaceId;
    if (root == null || wsId == null) return;

    final registered = _connections
        .where(
          (c) =>
              c.origin == DbConnectionOrigin.registered &&
              c.name != (previousName ?? conn.name),
        )
        .toList();
    await _store.save(root, [...registered, conn]);

    final oldKey = DbQueryService.secretKey(wsId, previousName ?? conn.name);
    final newKey = DbQueryService.secretKey(wsId, conn.name);
    if (previousName != null && previousName != conn.name) {
      // Rename: migra a senha guardada pra chave nova antes de apagar a velha
      // — editar sem redigitar a senha NUNCA a perde.
      final existing = await _secrets.read(oldKey);
      if (conn.savePassword &&
          existing != null &&
          (password == null || password.isEmpty)) {
        await _secrets.write(newKey, existing);
      }
      await _secrets.delete(oldKey);
    }
    if (!conn.savePassword) {
      await _secrets.delete(newKey);
    } else if (password != null && password.isNotEmpty) {
      // Só sobrescreve quando o usuário digitou algo; vazio = mantém a atual.
      await _secrets.write(newKey, password);
    }
    await reload();
  }

  Future<void> remove(DbConnection conn) async {
    final root = _workspaceRoot;
    final wsId = _workspaceId;
    if (root == null || wsId == null) return;
    await _store.save(root, [
      ..._connections.where(
        (c) => c.origin == DbConnectionOrigin.registered && c.name != conn.name,
      ),
    ]);
    await _secrets.delete(DbQueryService.secretKey(wsId, conn.name));
    await reload();
  }

  /// Testa uma conexão (inclusive não-salva, do dialog). `null` = OK; senão a
  /// mensagem de erro user-facing.
  Future<String?> test(DbConnection conn, {String? password}) async {
    final driver = _registry.forEngine(conn.engine);
    if (driver == null) {
      return '${conn.engine.label} support arrives with the anakiORM '
          'integration.';
    }
    var target = conn;
    final root = _workspaceRoot;
    if (conn.engine == DbEngine.sqlite && root != null) {
      final p = conn.sqlitePath;
      final absolute =
          p.startsWith('/') || RegExp(r'^[A-Za-z]:[\\/]').hasMatch(p);
      if (!absolute) target = conn.copyWith(url: 'sqlite:$root/$p');
    }
    try {
      await driver.query(target, 'SELECT 1', limit: 1, password: password);
      return null;
    } on DbQueryException catch (e) {
      return e.message;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
