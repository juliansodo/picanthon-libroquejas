# Capability Spec - ranking-and-discovery

## Intent

Habilitar descubrimiento de quejas destacadas desde sidebar con acceso rapido a ranking completo.

## Dependencies

- `specs/firestore-rest-persistence/spec.md`
- `specs/design-system-foundation/spec.md`
- `specs/core-object-comments/spec.md`

## Requirements

- Mostrar en sidebar la seccion `Quejas Destacadas` (emoji fuego) con hasta 5 items.
- Ordenar las quejas destacadas por likes en orden descendente.
- Incluir accion `Ver todas las quejas` que abra una pantalla interna del mismo sidebar.
- En la pantalla completa, listar todas las quejas con paginacion de 30 por pagina.
- Mantener orden por likes (descendente) en la vista completa.
- Mostrar para cada item metadatos minimos: alias autor, texto resumido, contador de likes y contador de respuestas.
- Permitir navegar desde un item a su contexto (seccion/popup correspondiente en la pagina actual).
- Si la consulta global falla, degradar a fallback local con mensaje explicito de estado.
- Formatear URL o contexto visible en formato compacto legible (`host/...`) cuando aplique.
- Obtener datos globales y paginados segun `specs/firestore-rest-persistence/spec.md`.
- Cumplir lineamientos visuales segun `specs/design-system-foundation/spec.md`.

## Scenarios

- GIVEN el sidebar abierto WHEN hay datos remotos THEN se muestran hasta 5 quejas destacadas ordenadas por likes.
- GIVEN el sidebar abierto WHEN se presiona `Ver todas las quejas` THEN se abre la vista interna con paginacion de 30.
- GIVEN falla la consulta global WHEN se renderiza la seccion destacada THEN se usa fallback local y mensaje de degradacion.
- GIVEN un usuario selecciona una queja destacada WHEN la extension puede ubicar contexto THEN abre el popup/seccion relacionada.

## Acceptance

- Sidebar siempre muestra exactamente una de estas opciones: destacadas remotas o fallback local explicito.
- La vista completa respeta paginacion de 30 e incluye navegacion de pagina anterior/siguiente.
- El orden por likes es consistente entre destacadas y vista completa.

## Non-goals

- Ranking separado de top paginas y top comentarios en accordion independiente.
- Recomendaciones personalizadas por usuario.
