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
| B1 — Purga backend | B | `claude/legacy-refactor/b1-backend-purge` | mergeado | 67 | −2361 LOC; `/lipsync/*` → `/avatar/speaking/*` con `tts_state` intacto |
| B2 — Purga frontend | B | `claude/legacy-refactor/b2-frontend-purge` | mergeado | 47 | `App.jsx` 1641→1035, `Settings.jsx` 1500→1096; bundle bajo 500 kB |
| B3 — Purga build/docs/i18n | B | `claude/legacy-refactor/b3-build-docs` | mergeado | 21 | −8070 LOC; `npm audit` del frontend de 7 a 2 |
| C — Separar rutas en `routes/` | C (barrera) | `claude/legacy-refactor/c-router-split` | mergeado | 20 | `app.js` 1526→258 LOC; 10 routers. Los 95 tests previos, sin tocar |
| D1 — Proveedores de IA | D | `claude/legacy-refactor/d1-ai-providers` | pendiente | — | |
| D2 — Overlays | D | `claude/legacy-refactor/d2-overlays` | pendiente | — | |
| D3 — Chat / Twitch / actividad | D | `claude/legacy-refactor/d3-chat-twitch` | pendiente | — | |
| D4 — Descomposición frontend | D | `claude/legacy-refactor/d4-frontend-split` | pendiente | — | |
| D5 — Settings server-side | D | `claude/legacy-refactor/d5-settings-source` | pendiente | — | Único con cambio observable; mergea al final |
| E1 — Raíz de confianza y auth | E | `claude/legacy-refactor/e1-auth-hardening` | mergeado | 25 | Sin default inseguro; subclaves HKDF; rotación de overlay tokens |
| E2 — Rate limits, CORS, cabeceras | E | `claude/legacy-refactor/e2-limits-headers` | pendiente | — | Requiere C mergeado; va tras D2/D3 |
| E3 — Dependencias | E | `claude/legacy-refactor/e3-deps` | mergeado | — | `npm audit` a 0 en ambos paquetes; puerta de auditoría en CI |

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

## Publicación en dev.vtamigo.top

Destino acordado: `https://dev.vtamigo.top` (checkout `/opt/vtamigo-dev`, rama
`dev`, puerto 3002). **`master` no se toca** — es producción y se despliega sola
por GitHub Actions al recibir un push.

El flujo sancionado (`MEMORIES.md`, `server/README.md` en `dev`) es: rama de
trabajo → merge en `dev` → `push origin dev` → en la caja, `git pull`. **No hay
auto-deploy desde `origin/dev`**: el timer que lo hacía se retiró porque corría
`git reset --hard` y destruía las ediciones in situ.

Pasos, y quién puede hacer cada uno:

| Paso | Quién |
|---|---|
| 1. Mergear la rama base en `dev` y `git push origin dev` | El agente |
| 2. `cd /opt/vtamigo-dev && git pull` | **Requiere acceso a la caja** |
| 3. `npm ci` en `backend/` **y** en `frontend/` | **Requiere acceso a la caja** |

El paso 3 es **obligatorio esta vez**, no opcional: los dos `package.json`
cambiaron de forma sustancial (Vitest + supertest en backend; Vitest, jsdom y
Testing Library en frontend, `@xenova/transformers` fuera y Vite 5→6.4.3). La
instalación de dependencias es justo lo que los watchers *no* hacen solos.

Hecho eso, los watchers se encargan del resto: `node --watch` reinicia el
backend en ~1s y `vite build --watch` reconstruye el frontend en 1-3s.

### Riesgo a verificar antes del paso 2

El lote E1 hace que el backend **se niegue a arrancar** en producción sin
`SESSION_SECRET`, y la unidad systemd fija `APP_ENV=production` también en dev.
`MEMORIES.md` documenta que `SESSION_SECRET` sí está en `/etc/vtamigo-dev.env`,
así que en principio arranca — pero conviene confirmarlo en la caja antes de
tirar del pull, porque si falta, el servicio queda caído y `dev.vtamigo.top`
devuelve 502.

## Pendiente al cerrar esta tanda

Completadas: **A, B, C, E1, E3**. Quedan la **Fase D** (5 lotes de reescritura
con cobertura) y **E2** (rate limits, CORS, cabeceras). E2 ya puede arrancar:
su prerrequisito era la Fase C, que está mergeada.

Dos cabos sueltos concretos que dejaron los lotes cerrados:

- **`rotateOverlayToken` no está enganchada a ninguna ruta.** E1 la dejó lista
  pero `app.js` era territorio de C en ese momento. Quiere un
  `POST /overlay-token/rotate` tras `requireApprovedUser`, devolviendo
  `{ token: rotateOverlayToken(req.user.twitchId) }`. Sin eso no hay forma de
  revocar un overlay token filtrado desde la interfaz.
- **`SESSION_LEGACY_COOKIES=0`** debe ponerse ~30 días después de desplegar E1,
  para retirar la aceptación de cookies firmadas con el secreto desnudo.

Observaciones que C anotó y dejó intactas a propósito (era un lote de mover, no
reescribir), pendientes de decisión:

- `videoRouter` repite `requireApprovedUser` en rutas que el prefijo `/video` ya
  cubre; redundante pero inofensivo. Unificarlo cambia el orden de evaluación.
- `routes/overlayBuilder.js` hace `fs.mkdirSync` en tiempo de import, así que un
  simple `require` del router crea `backend/data/overlayAssets/tmp`.
- `app.get("*")` funciona en Express 4 pero es el patrón que rompe en Express 5.

## Trabajo a medias (C y E1) — cómo retomarlo

**RESUELTO** — ambos se completaron y mergearon. Se conserva el registro porque
explica por qué sus ramas llevan un commit `WIP` intermedio en la historia.

Ambos lotes se cortaron por un límite de sesión de la plataforma, no por un
problema del código. Su trabajo quedó commiteado como `WIP` y deliberadamente
sin mergear: media separación de rutas deja el árbol sin arrancar, y medio
endurecimiento de autenticación es peor que ninguno.

**C (`claude/legacy-refactor/c-router-split`, commit WIP)** — hecho:
`backend/sessions.js` (318 LOC) y `routes/{ai,chat,overlays}.js` (579 LOC).
Falta: reescribir `app.js` para montarlos, los routers `overlayBuilder`, `video`,
`xp`, `stream`, `tts`, `settings` y `activity`, y `test/routing.test.js`.
Recordatorio del criterio: **la suite de la Fase B debe pasar sin tocar un solo
test**, y el guard de `PROTECTED_PREFIXES` tiene que seguir montándose antes que
todos los routers de dominio.

**E1 (`claude/legacy-refactor/e1-auth-hardening`, commit WIP)** — hecho:
`auth.js` con derivación de subclaves por propósito y la comprobación de
`SESSION_SECRET` (163 líneas). Falta: `adminAuth.js` (`timingSafeEqual` y la
subclave de admin), la persistencia de la versión del overlay token, y
`test/authHardening.test.js`. **Sin verificar** — no mergear sin tests en verde.

Al retomarlos: las ramas son locales de este contenedor. Si se perdieron, el
plan de arriba basta para rehacerlos; nada de lo pendiente depende de código que
solo exista ahí.

## Bloqueos y decisiones abiertas

*(append únicamente — no reescribir entradas ajenas)*

- **[Integración Fase B]** Cerrada. Dos huecos que ningún lote podía ver solo,
  resueltos al integrar:
  1. **Tests que dependían de claves borradas en paralelo.** B2 escribió sus
     aserciones de purga leyendo las cadenas del locale `en`, pero B3 borró esas
     mismas claves. Un test de purga cuyas expectativas desaparecen junto con la
     feature no prueba nada, así que ahora fija los literales históricos
     (sacados de la historia de git). Aplica a las 12 secciones y al cartel
     `onlyClaude`.
  2. **Claves i18n huérfanas y prosa desactualizada.** B3 no podía saber qué
     claves dejaría huérfanas B2. Eliminadas en los 4 locales: `faq.items.vtube`,
     `settings.aiProvider.onlyClaude`, `quickControls.chooseVoice` y
     `quickControls.saved` (esta última anclada a `chooseVoice` para no tocar la
     `saved` de Stream Settings, que sigue viva). Además se reescribió — no se
     borró — la prosa que seguía anunciando VTube Studio o ElevenLabs en
     `login.footer`, `login.features.overlay.desc`, `faq.items.data.a`,
     `settings.avatarOverlay.title` y el paso `statusFooter` del onboarding.
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
  - **Dependencias** — backend limpio; 5 de las 7 vulnerabilidades del frontend
    (crítica de `protobufjs`, altas de `sharp`) colgaban de `@xenova/transformers`,
    que no tenía ni una referencia en el código. **Confirmado tras mergear B3:
    `npm audit` del frontend baja de 7 (1 crítica, 5 altas, 1 moderada) a 2.**
    Las dos restantes son la misma causa raíz — `esbuild` vía `vite` — y afectan
    solo al servidor de desarrollo, no a producción. **Cerrado en E3** con
    `vite@6.4.3`: el aviso cubre `vite <=6.4.2`, así que basta un salto mayor en
    vez de los tres que proponía `npm audit fix` (vite@8), y Vitest 3 y
    `@vitejs/plugin-react` 4 siguen funcionando sin tocarlos. **Ambos paquetes
    reportan ahora 0 vulnerabilidades**, y el CI falla ante cualquier aviso
    `high` o `critical` nuevo.
  - Descartado como falso positivo: XSS en los overlays (todo entra por
    `textContent`), inyección SQL (sentencias preparadas), inyección de comandos
    (`spawn` con array, sin `shell`), path traversal en subidas (nombres
    derivados de `twitchId` + UUID + extensión de un mapa MIME cerrado), y
    escalada de sesión de usuario a admin (`requireAdmin` valida `subject`).
