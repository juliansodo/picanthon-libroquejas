# ADR-001 - Firestore REST over SDK remoto

## Contexto

En content script MV3 hubo bloqueos/import failures al intentar SDK remoto dinamico.

## Decision

Usar Firestore REST (`fetch`) como mecanismo principal de lectura/escritura.

## Consecuencias

- Pros: compatible con MV3, control total de requests.
- Contras: mas logica manual de serializacion/parsing.
