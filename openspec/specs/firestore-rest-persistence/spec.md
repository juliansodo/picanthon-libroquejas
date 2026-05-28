# Capability Spec - firestore-rest-persistence

## Intent

Definir una capa de persistencia compartida via Firestore REST para MV3, sin backend propio ni SDK remoto en content script.

## Dependencies

- `decisions/ADR-001-firestore-rest-over-sdk.md`
- `specs/core-object-comments/spec.md`
- `specs/ranking-and-discovery/spec.md`

## Data Model

- Coleccion principal: `comments`.
- Documento `comments/{commentId}`:
  - `pageId` (string)
  - `pageUrl` (string)
  - `x`, `y`, `xRatio`, `yRatio` (number)
  - `parentId` (string opcional)
  - `userId`, `username` (string)
  - `text` (string)
  - `emoji` (string opcional)
  - `likedBy` (array string)
  - `likeCount` (number derivado para orden eficiente)
  - `createdAt` (timestamp)

## Requirements

- Usar Firestore REST (`fetch`) como mecanismo principal de lectura/escritura.
- Cargar credenciales desde `src/firebase-config.js` (`projectId`, `apiKey`).
- Incluir `apiKey` en requests REST cuando aplique.
- Serializar y deserializar documentos al formato `fields` de Firestore.
- Operaciones minimas sobre `comments`:
  - crear documento (POST),
  - actualizar campos parciales (PATCH, por ejemplo `likedBy` y `likeCount`),
  - eliminar comentario (DELETE),
  - consultar por `pageId` para popup/seccion,
  - consultar destacadas globales ordenadas por `likeCount` y `createdAt`.
- Tratar `likedBy` como fuente de verdad de likes y `likeCount` como campo derivado.
- Exponer permisos de host requeridos (`*.googleapis.com`) en manifest MV3.
- Manejar errores HTTP con mensajes cortos y claros para UI.
- Aplicar backoff/cooldown ante `429` para evitar bucles de reintento.
- Pausar o reducir polling cuando la pestana este oculta.
- Loguear requests solo en modo debug (`DEBUG_FIRESTORE=true`).

## Scenarios

- GIVEN una nueva queja WHEN se ejecuta POST THEN se guarda en `comments` y retorna id usable por UI.
- GIVEN un like valido WHEN se ejecuta PATCH THEN se actualizan `likedBy` y `likeCount` de forma consistente.
- GIVEN un borrado confirmado WHEN se ejecuta DELETE THEN el comentario deja de aparecer en consultas siguientes.
- GIVEN un fallo `429` WHEN se intenta reconsultar THEN se respeta cooldown antes del siguiente intento.
- GIVEN un fallo de consulta global WHEN ranking solicita destacadas THEN retorna error controlado para fallback local.

## Acceptance

- Lectura y escritura funcionan en content script sin requerir SDK remoto.
- Crear, likear y eliminar quejas persiste correctamente en Firestore.
- Consultas por seccion y destacadas globales devuelven datos parseados y ordenables.
- Ante fallos de red/rate limit, la capa entrega estado degradado sin romper la UI.

## Non-goals

- Implementar backend propio o proxy intermedio.
- Gestionar autenticacion de usuarios con sesiones remotas.
