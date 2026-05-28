# Project Context

## Nombre

Libro de Quejas de Internet

## Objetivo

Crear una extensión de Chrome para comentarios anónimos sobre objetos visuales de cualquier página web.

## Stack

- Chrome Extension MV3
- Vanilla JS, HTML, CSS
- Design tokens CSS como base visual del producto
- Firebase Firestore (REST)
- chrome.storage.local

## Restricciones

- Sin login tradicional.
- Sin backend propio.
- Priorización de demo/hackathon sobre hardening productivo.

## Lineamientos relevantes

- El sistema de diseño (tokens + CSS semántico) es parte del baseline del producto, no un change opcional.
- La persistencia Firestore REST es capability transversal (`specs/firestore-rest-persistence/spec.md`), referenciada por specs de dominio.
