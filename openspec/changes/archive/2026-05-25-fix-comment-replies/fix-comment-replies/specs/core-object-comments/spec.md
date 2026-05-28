# Cambios - respuestas de comentarios

## Requirement: Respuestas a comentarios

El sistema DEBE permitir responder comentarios existentes usando `parentId`.

### Scenario: Abrir formulario de respuesta

GIVEN un comentario visible
WHEN el usuario hace click en "Responder"
THEN se muestra un textarea debajo del comentario
AND el foco pasa automáticamente al textarea

---

### Scenario: Crear respuesta

GIVEN un formulario de respuesta abierto
WHEN el usuario envía una respuesta válida
THEN se crea un nuevo comentario hijo usando `parentId`
AND la respuesta aparece debajo del comentario padre
AND la UI se actualiza sin recargar la página

---

### Scenario: Persistencia de respuestas

GIVEN una respuesta ya creada
WHEN el usuario refresca la página
THEN la respuesta sigue visible y asociada al comentario padre