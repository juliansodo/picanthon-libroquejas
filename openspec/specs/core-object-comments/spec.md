# Capability Spec - core-object-comments

## Intent

Permitir crear y navegar quejas por objeto/seccion con hilos, likes y reglas de interaccion consistentes.

## Dependencies

- `specs/firestore-rest-persistence/spec.md`
- `specs/design-system-foundation/spec.md`
- `specs/ranking-and-discovery/spec.md`

## Data Model

- Entidad `Comment` minima:
  - `id`
  - `pageId`
  - `pageUrl`
  - `x`, `y`, `xRatio`, `yRatio`
  - `parentId` (opcional)
  - `userId`, `username`
  - `text`
  - `emoji`
  - `likedBy[]`
  - `createdAt`

## Requirements

- Crear identidad local (`userId`, `username`) al primer uso y usarla en cada queja/respuesta.
- Activar modo queja automaticamente al abrir el sidebar de quejas y mantenerlo activo mientras el sidebar permanezca abierto.
- Permitir comentar solo en modo objeto.
- Persistir cada comentario con `pageId`, `pageUrl`, `x/y`, `xRatio/yRatio`.
- Renderizar marcadores agrupados por objeto/seccion con badge de cantidad clickeable.
- Al abrir comentarios de una seccion, mostrar lista ordenada por likes (descendente).
- Permitir respuestas anidadas mediante `parentId`.
- Permitir eliminar comentarios propios.
- No permitir editar comentarios propios.
- Permitir like/unlike solo en comentarios ajenos.
- Permitir like/unlike desde popup y desde sidebar con estado sincronizado.
- Mostrar selector de emoji predefinido y usar emoji por defecto cuando no se selecciona uno.
- Mantener aislamiento de room por cambio de URL SPA.
- Persistir y sincronizar datos segun `specs/firestore-rest-persistence/spec.md`.
- Cumplir lineamientos visuales de `specs/design-system-foundation/spec.md`.

## Scenarios

- GIVEN un usuario sin identidad local WHEN abre por primera vez la extension THEN se crea `userId` y `username`.
- GIVEN el sidebar de quejas abierto WHEN el usuario navega o cambia de tab THEN el modo queja se revalida y permanece activo.
- GIVEN una seccion con multiples quejas WHEN se abre su popup THEN la lista aparece ordenada por cantidad de likes de mayor a menor.
- GIVEN un comentario propio WHEN intenta editarlo THEN la UI no ofrece opcion de edicion.
- GIVEN un comentario propio WHEN intenta dar like THEN la accion se bloquea y no cambia `likedBy`.
- GIVEN un comentario propio WHEN confirma eliminar THEN el comentario desaparece de la vista y se elimina en persistencia.

## Acceptance

- Una nueva queja queda visible en <= 3s en la seccion objetivo.
- Mientras el sidebar este abierto, el modo queja permanece activo y listo para seleccionar objetos.
- El estado de like queda sincronizado entre popup, sidebar y persistencia remota.
- Los comentarios legacy siguen funcionando con fallback de coordenadas `x/y` cuando falten ratios.

## Non-goals

- Sistema de autenticacion con login.
- Edicion del texto de una queja ya publicada.
- Moderacion automatica de contenido.
