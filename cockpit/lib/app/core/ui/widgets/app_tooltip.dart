import 'dart:async' show Timer;

import 'package:shadcn_flutter/shadcn_flutter.dart';

/// Tooltip do app — substitui o `Tooltip` do shadcn onde a posição importa.
///
/// Por quê: o `Tooltip` do shadcn publica no `OverlayManager` do `ShadcnApp`,
/// que fica **acima** do `_AppZoom` (o FittedBox do "Interface size"). Com zoom
/// ≠ 1.0, o âncora é medido no espaço lógico reduzido e o balão desloca
/// proporcional à distância do canto superior esquerdo — visível nos painéis da
/// direita. Este widget usa o **mesmo overlay dos popovers/menus** (handler
/// padrão do [PopoverController]), que vive dentro do zoom → posição correta em
/// qualquer escala.
class AppTooltip extends StatefulWidget {
  const AppTooltip({super.key, required this.message, required this.child});

  final String message;
  final Widget child;

  @override
  State<AppTooltip> createState() => _AppTooltipState();
}

class _AppTooltipState extends State<AppTooltip> {
  final PopoverController _controller = PopoverController();
  Timer? _wait;

  @override
  void dispose() {
    _wait?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _show() {
    if (!mounted) return;
    _controller.show(
      context: context,
      modal: false,
      builder: (context) => TooltipContainer(child: Text(widget.message)),
      // Balão logo abaixo do trigger, centralizado (default do shadcn).
      alignment: Alignment.topCenter,
      anchorAlignment: Alignment.bottomCenter,
      dismissBackdropFocus: false,
      overlayBarrier: const OverlayBarrier(barrierColor: Colors.transparent),
      // SEM handler custom: cai no overlay dos popovers (dentro do zoom).
    );
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onEnter: (_) {
        _wait?.cancel();
        _wait = Timer(const Duration(milliseconds: 500), _show);
      },
      onExit: (_) {
        _wait?.cancel();
        _controller.close();
      },
      child: widget.child,
    );
  }
}
