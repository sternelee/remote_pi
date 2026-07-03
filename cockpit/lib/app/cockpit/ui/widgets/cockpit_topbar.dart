import 'dart:io';

import 'package:cockpit/app/core/ui/menu/app_menu_bar.dart';
import 'package:cockpit/app/core/ui/menu/editor_menu_bridge.dart';
import 'package:cockpit/app/core/ui/menu/workspace_menu_bridge.dart';
import 'package:cockpit/app/core/ui/settings_controller.dart';
import 'package:cockpit/app/core/ui/widgets/window_controls.dart';
import 'package:cockpit/app/core/ui/themes/themes.dart';
import 'package:cockpit/app/core/ui/widgets/hover_tap.dart';
import 'package:flutter_modular/flutter_modular.dart';
import 'package:shadcn_flutter/shadcn_flutter.dart';

/// Top bar (~46px) customizada — substitui a barra nativa da janela. Semáforo
/// macOS **funcional** (fecha/minimiza/maximiza) · toggle da rail · nome do
/// projeto. A barra inteira arrasta a janela (via [WindowTitleBar]).
class CockpitTopbar extends StatelessWidget {
  const CockpitTopbar({
    super.key,
    required this.projectName,
    required this.railVisible,
    required this.treeVisible,
    required this.onToggleRail,
    required this.onToggleTree,
  });

  final String projectName;
  final bool railVisible;
  final bool treeVisible;
  final VoidCallback onToggleRail;
  final VoidCallback onToggleTree;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return WindowTitleBar(
      children: [
        const WindowControls(),
        const SizedBox(width: 12),
        // Windows/Linux: barra de menu desenhada na janela (estilo VS Code), ao
        // lado do título. No macOS o [WindowMenuBar] é no-op (barra é a nativa).
        if (!Platform.isMacOS) ...[
          WindowMenuBar(
            menus: buildAppMenus(
              context.watch<SettingsController>(),
              context.watch<EditorMenuBridge>(),
              context.watch<WorkspaceMenuBridge>(),
            ),
          ),
          const SizedBox(width: 8),
        ],
        _IconBtn(
          icon: Icons.view_sidebar_outlined,
          tooltip: 'Collapse sidebar',
          active: !railVisible,
          onTap: onToggleRail,
        ),
        const SizedBox(width: 8),
        Text(
          projectName,
          style: context.typo.title.copyWith(fontSize: 14, color: colors.text),
        ),
        const Spacer(),
        _IconBtn(
          icon: Icons.view_sidebar_outlined,
          tooltip: 'Show/hide files',
          active: !treeVisible,
          onTap: onToggleTree,
        ),
        const WindowControlsTrailing(),
      ],
    );
  }
}


class _IconBtn extends StatelessWidget {
  const _IconBtn({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Tooltip(
      tooltip: (context) => TooltipContainer(child: Text(tooltip)),
      child: HoverTap(
        onTap: onTap,
        color: active ? colors.accentSoft : null,
        hoverColor: colors.panel3,
        borderRadius: BorderRadius.circular(5),
        child: SizedBox(
          width: 28,
          height: 28,
          child: Icon(
            icon,
            size: 17,
            color: active ? colors.accentText : colors.text3,
          ),
        ),
      ),
    );
  }
}
