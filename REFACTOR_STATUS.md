# Estado de la refactorización del legado desktop

VTAmigo nació como app de escritorio Electron para un solo streamer en Windows y
hoy es una web multi-cuenta hospedada. Esta refactorización cierra esa migración:
borra lo que quedó residual, reimplementa sin cambiar comportamiento lo que sigue
vivo pero mal ubicado, y deja cobertura de pruebas donde no había ninguna.

El plan completo (kill list, propiedad de archivos por lote, criterios de
aceptación) vive fuera del repo; este archivo es el tablero de estado.

## Reglas de coordinación

- Cada lote sale de la **rama base actualizada** (`claude/legacy-features-refactor-plan-gxwoc7`), no de `master`.
- Cada agente edita **solo su propia fila** de la tabla. Dos agentes concurrentes
  editando filas distintas no producen conflicto real.
- La fila se actualiza **en el mismo commit** que cierra el lote.
- La sección "Bloqueos y decisiones abiertas" se escribe **con append**, nunca
  reescribiendo lo ajeno.
- Un lote no se mergea a la base sin `npm test` en verde.

Estados: `pendiente` → `en curso` → `en revisión` → `mergeado` → `bloqueado`.

## Fases

Las fases A y C son **barreras de sincronización**: nadie arranca la siguiente
hasta que la anterior está mergeada en la base. Dentro de B y D los lotes tienen
conjuntos de archivos disjuntos, y ahí está el paralelismo real.

| Lote | Fase | Rama | Estado | Tests | Notas |
|---|---|---|---|---|---|
| A — Infra de pruebas y CI | A (barrera) | `claude/legacy-refactor/a-test-infra` | mergeado | 9 | `app.js` exportable; Vitest+supertest+RTL; CI de tests |
| B1 — Purga backend | B | `claude/legacy-refactor/b1-backend-purge` | pendiente | — | |
| B2 — Purga frontend | B | `claude/legacy-refactor/b2-frontend-purge` | pendiente | — | |
| B3 — Purga build/docs/i18n | B | `claude/legacy-refactor/b3-build-docs` | pendiente | — | |
| C — Separar rutas en `routes/` | C (barrera) | `claude/legacy-refactor/c-router-split` | pendiente | — | Refactor puro: la suite de B debe pasar sin tocar un test |
| D1 — Proveedores de IA | D | `claude/legacy-refactor/d1-ai-providers` | pendiente | — | |
| D2 — Overlays | D | `claude/legacy-refactor/d2-overlays` | pendiente | — | |
| D3 — Chat / Twitch / actividad | D | `claude/legacy-refactor/d3-chat-twitch` | pendiente | — | |
| D4 — Descomposición frontend | D | `claude/legacy-refactor/d4-frontend-split` | pendiente | — | |
| D5 — Settings server-side | D | `claude/legacy-refactor/d5-settings-source` | pendiente | — | Único con cambio observable; mergea al final |
| E1 — Raíz de confianza y auth | E | `claude/legacy-refactor/e1-auth-hardening` | pendiente | — | Independiente; puede correr en paralelo con D |
| E2 — Rate limits, CORS, cabeceras | E | `claude/legacy-refactor/e2-limits-headers` | pendiente | — | Requiere C mergeado; va tras D2/D3 |
| E3 — Dependencias | E | `claude/legacy-refactor/e3-deps` | pendiente | — | Puede arrancar en cuanto B3 esté mergeado |

## Restricciones duras

1. **`/lipsync/start` y `/lipsync/stop` son el único driver del avatar overlay.**
   Emiten `{type:"tts_state", playing}` por WebSocket, que consume
   `backend/overlay/avatar.html`, **además** de mover VTube Studio. Al eliminar
   VTS hay que **conservar el broadcast**: se renombran a
   `/avatar/speaking/start|stop` y se actualiza `frontend/src/TTSController.js`.
   Romperlo deja mudo el avatar de todos los usuarios.
2. **`backend/youtube.js` NO se borra** — sirve a la cola de canciones `!sr`, que
   se queda. Lo que muere es el *YouTube peek* (`/youtube-narrate`).
3. **`cheerio` NO se quita de `backend/package.json`** — `youtube.js` lo usa
   aunque `reddit.js` muera. Sí se quita del `package.json` **raíz**.
4. **Cero cambios de comportamiento visible** fuera de las features borradas.
5. **`frontend/DESIGN.md` es la fuente de verdad visual** (ver `CLAUDE.md`).
6. **`PROTECTED_PREFIXES` en `backend/app.js` es lo único que autentica varias
   rutas.** Renombrar una ruta sin actualizar esa lista la deja sin autenticar
   en silencio — `req.user` pasa a ser `undefined`. Al mover `/lipsync` a
   `/avatar`, hay que añadir `/avatar` a la lista. `/xp/ranking`, `/video/state`,
   `/video/ended` y `/overlay/*` se saltan el guard **a propósito** (OBS no tiene
   cookie de sesión) y hacen su propia comprobación inline.
7. **No desinstales `express-rate-limit`** al borrar `devices.js`. Es el único
   consumidor hoy, pero el lote E2 lo reutiliza para devolver limitación de tasa
   a `/admin/login`, `/respond` y las subidas.

## Cómo correr las pruebas

```bash
npm test                      # backend + frontend
npm --prefix backend test     # solo backend (Vitest + supertest, APP_ENV=test)
npm --prefix frontend test    # solo frontend (Vitest + jsdom + Testing Library)
```

El backend corre contra `backend/data/db/vtamigo.test.sqlite3`, separado de la
base de desarrollo y ya cubierto por `.gitignore`.

## Bloqueos y decisiones abiertas

*(append únicamente — no reescribir entradas ajenas)*

- **[Fase A]** El proxy de dev en `frontend/vite.config.js` todavía enruta
  `/reddit-story`, `/reddit-thoughts`, `/vtube`, `/lipsync`, `/youtube-narrate`,
  `/screenwatch`, `/screen-answer` y `/transcribe`. No estaba en la kill list
  original. **Asignado a B2** junto con el resto de la purga frontend; `/lipsync`
  debe pasar a `/avatar`.
- **[Fase A]** `electron/main.js`, el script `dev` de la raíz y `.claude/launch.json`
  apuntan a `backend/index.js`. Sigue existiendo como entry point, así que nada
  se rompe; B3 se lleva `electron/` por delante de todos modos.
- **[Auditoría de seguridad]** Añadida la Fase E al plan. Resultado de la
  auditoría sobre el código real:
  - **Alta** — `SESSION_SECRET` cae a `"dev-insecure-session-secret"`, y de ese
    valor cuelgan los JWT de usuario, los de admin, la clave AES que cifra los
    tokens de Twitch en reposo y el HMAC de los overlay tokens. Debe fallar al
    arrancar en producción (E1).
  - **Alta** — la purga de `devices.js` elimina el **único** rate limiter del
    backend. Sin acción deliberada, la Fase B deja `/admin/login` sin protección
    contra fuerza bruta (E2).
  - **Media** — `ADMIN_PASSWORD` se compara con `!==`, no en tiempo constante (E1).
  - **Media** — `wrapUntrusted` no neutraliza `</untrusted_data>` dentro del
    contenido, así que un mensaje de chat puede escaparse del envoltorio
    (addendum a D1, que ya reescribe ese archivo).
  - **Baja-media** — `cors({ origin: true, credentials: true })` refleja
    cualquier Origin; acotado en la práctica por las cookies `sameSite: "lax"` (E2).
  - **Dependencias** — backend limpio; 6 de las 7 vulnerabilidades del frontend
    (crítica de `protobufjs`, altas de `sharp`) cuelgan de `@xenova/transformers`,
    que B3 ya borra por no tener referencias. Se resuelven con la purga (E3).
  - Descartado como falso positivo: XSS en los overlays (todo entra por
    `textContent`), inyección SQL (sentencias preparadas), inyección de comandos
    (`spawn` con array, sin `shell`), path traversal en subidas (nombres
    derivados de `twitchId` + UUID + extensión de un mapa MIME cerrado), y
    escalada de sesión de usuario a admin (`requireAdmin` valida `subject`).
