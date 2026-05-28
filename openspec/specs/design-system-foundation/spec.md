# Capability Spec - design-system-foundation

## Intent

Definir una base visual consistente y reutilizable para la extension usando design tokens semanticos.

## Dependencies

- `specs/core-object-comments/spec.md`
- `specs/ranking-and-discovery/spec.md`

## Requirements

- Mantener `design-tokens.css` como fuente de verdad visual.
- Implementar UI en CSS puro consumiendo tokens semanticos (`var(--token)`).
- Cubrir color, typography, spacing, radius, shadow, motion y z-index.
- Aplicar tokens en componentes core: sidebar, destacadas, lista de comentarios, hilos, popup de objeto y marcadores.
- Incluir en sidebar un estado visual claro para modo queja activo/inactivo.
- Garantizar contraste legible en tema oscuro para texto e interacciones.
- Usar esta paleta base obligatoria:
  - `--color-text-primary: rgba(245, 245, 247, 1)`
  - `--color-text-muted: rgba(172, 172, 181, 1)`
  - `--color-bg-secondary: rgba(65, 54, 85, 1)`
  - `--color-bg-primary: rgba(34, 32, 40, 1)`
  - `--color-bg-surface: rgba(47, 45, 58, 1)`
  - `--color-accent: rgba(152, 88, 250, 1)`
- Mantener tokens minimos de estructura:
  - `--radius-md: 10px`
  - `--space-2`, `--space-3`, `--space-4`
  - `--z-marker`, `--z-popup`, `--z-sidebar`
- Evitar hardcodear colores o espacios cuando exista token equivalente.

## Scenarios

- GIVEN el sidebar renderizado WHEN se inspeccionan estilos THEN usa tokens de texto, fondo, espaciado y radius.
- GIVEN popup de quejas sobre seccion WHEN cambia estado hover/focus THEN mantiene contraste legible en tema oscuro.
- GIVEN nueva pantalla de `Ver todas las quejas` WHEN se renderiza THEN reutiliza la misma paleta y escala de espaciado.

## Acceptance

- Las vistas core usan tokens semanticos como fuente principal de estilos.
- Sidebar, popup y ranking mantienen apariencia consistente y responsive.
- La capa visual no altera flujos funcionales de comentarios, likes, hilos ni destacadas.

## Non-goals

- Soporte de temas claros en esta etapa.
- Framework CSS externo o runtime de estilos.
