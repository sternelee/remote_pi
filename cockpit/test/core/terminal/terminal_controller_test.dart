import 'dart:convert';

import 'package:cockpit/app/core/domain/entities/app_settings.dart';
import 'package:cockpit/app/core/terminal/terminal_controller.dart';
import 'package:flterm/flterm.dart' as ghost;
import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  for (final engine in TerminalEngine.values) {
    group('${engine.name} terminal controller', () {
      late CockpitTerminalController terminal;

      setUp(() => terminal = createTerminalController(engine));
      tearDown(() => terminal.dispose());

      test('renders VT output as plain text', () {
        terminal.write('\x1b[31mhello\x1b[0m');

        expect(terminal.plainLines().join('\n'), contains('hello'));
      });

      test('paste emits bytes for the PTY', () {
        final output = <int>[];
        terminal.onOutput = output.addAll;

        terminal.paste('olá');

        expect(utf8.decode(output), 'olá');
      });

      test('reports OSC title changes', () {
        String? title;
        terminal.onTitleChanged = (value) => title = value;

        terminal.write('\x1b]0;workspace\x07');

        expect(title, 'workspace');
      });

      test('restores persisted output', () {
        terminal.restore('restored');

        if (terminal case final GhosttyTerminalController ghostty) {
          expect(terminal.plainLines().join('\n'), isNot(contains('restored')));
          ghostty.controller.onResize?.call(120, 40);
        }

        expect(terminal.plainLines().join('\n'), contains('restored'));
      });
    });
  }

  group('Windows engine gate', () {
    // Ghostty (flterm) engole teclas printáveis no Windows → a plataforma fica
    // travada no xterm: seletor some e qualquer engine pedido cai pra xterm.
    setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.windows);
    tearDown(() => debugDefaultTargetPlatformOverride = null);

    test('engine não é selecionável no Windows', () {
      expect(terminalEngineIsSelectable, isFalse);
    });

    test('resolveTerminalEngine força xterm no Windows', () {
      expect(
        resolveTerminalEngine(TerminalEngine.ghostty),
        TerminalEngine.xterm,
      );
      expect(resolveTerminalEngine(TerminalEngine.xterm), TerminalEngine.xterm);
    });

    test('createTerminalController(ghostty) cai pra xterm no Windows', () {
      final terminal = createTerminalController(TerminalEngine.ghostty);
      addTearDown(terminal.dispose);
      expect(terminal.engine, TerminalEngine.xterm);
    });
  });

  test('engine é selecionável fora do Windows (macOS)', () {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    expect(terminalEngineIsSelectable, isTrue);
    expect(
      resolveTerminalEngine(TerminalEngine.ghostty),
      TerminalEngine.ghostty,
    );
  });

  group('Ghostty replay não vaza resposta de query pro PTY', () {
    test('restore (scrollback) com Primary DA não emite resposta no onOutput',
        () {
      final terminal = GhosttyTerminalController();
      addTearDown(terminal.dispose);
      final out = <int>[];
      terminal.onOutput = out.addAll;
      // Query embutida no histórico restaurado (Primary DA `ESC[c`).
      terminal.restore('\x1b[c');
      // Dispara o flush do replay (o restore fica na fila até o 1º resize).
      terminal.controller.onResize?.call(120, 40);
      // A resposta (`ESC[?...c`) foi suprimida — não vaza pro PTY.
      expect(out, isEmpty);
    });

    test('write ao vivo com Primary DA responde normalmente', () {
      final terminal = GhosttyTerminalController();
      addTearDown(terminal.dispose);
      // Marca o resize inicial (sem defer) pra `write` não cair na fila.
      terminal.controller.onResize?.call(120, 40);
      final out = <int>[];
      terminal.onOutput = out.addAll;
      terminal.write('\x1b[c');
      expect(out, isNotEmpty);
    });
  });

  testWidgets('Ghostty restores OSC state after the initial layout', (
    tester,
  ) async {
    final terminal = GhosttyTerminalController();
    addTearDown(terminal.dispose);
    terminal.restore('\x1b]7;file:///tmp\x07restored');

    await tester.pumpWidget(
      Directionality(
        textDirection: TextDirection.ltr,
        child: SizedBox(
          width: 800,
          height: 600,
          child: ghost.TerminalView(controller: terminal.controller),
        ),
      ),
    );

    expect(tester.takeException(), isNull);
    expect(terminal.controller.pwd, 'file:///tmp');
    expect(terminal.plainLines().join('\n'), contains('restored'));
  });
}
