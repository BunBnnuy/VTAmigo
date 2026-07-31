import React, { useState, useEffect } from "react";
import { tts } from "./TTSController.js";
import { voice } from "./VoiceTranscription.js";
import { apiFetch } from "./api.js";

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState(settings);
  const [voices, setVoices] = useState([]);
  const [micDevices, setMicDevices] = useState([]);
  const [elevenVoices, setElevenVoices] = useState([]);
  const [elevenVoicesStatus, setElevenVoicesStatus] = useState(""); // "", "loading", "error message"
  const [piperVoices, setPiperVoices] = useState([]);
  const [piperStatus, setPiperStatus] = useState(""); // "", "loading", "ok", "missing", "error message"
  const [exportTarget, setExportTarget] = useState("");
  const [exportStatus, setExportStatus] = useState(null); // null | {running, pct, stage, error, mdPath}
  const [importFile, setImportFile] = useState(null); // { name, content }
  const [importStatus, setImportStatus] = useState(null); // null | {running, error, ok}

  // Poll export progress while a job is running
  useEffect(() => {
    if (!exportStatus?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch("/memory/export/status");
        setExportStatus(await res.json());
      } catch {
        // Backend unreachable — keep last known state and retry
      }
    }, 700);
    return () => clearInterval(timer);
  }, [exportStatus?.running]);

  const startMemoryExport = async (from, to) => {
    try {
      const res = await apiFetch("/memory/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setExportStatus({ running: true, pct: 0, stage: "Iniciando…", error: null, mdPath: null });
    } catch (err) {
      setExportStatus({ running: false, pct: 0, stage: "", error: err.message, mdPath: null });
    }
  };

  const handleMemoryFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportFile({ name: file.name, content: String(reader.result || "") });
    reader.onerror = () => setImportStatus({ running: false, error: `No se pudo leer ${file.name}` });
    reader.readAsText(file);
  };

  const importMemoryFile = async (provider) => {
    if (!importFile) return;
    setImportStatus({ running: true, error: null, ok: false });
    try {
      const res = await apiFetch("/memory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, markdown: importFile.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setImportStatus({ running: false, error: null, ok: true });
    } catch (err) {
      setImportStatus({ running: false, error: err.message, ok: false });
    }
  };

  const loadPiperVoices = async () => {
    setPiperStatus("loading");
    try {
      const res = await apiFetch("/tts/piper/voices");
      const data = await res.json();
      setPiperVoices(data.voices || []);
      setPiperStatus(data.installed ? "ok" : "missing");
    } catch (err) {
      setPiperVoices([]);
      setPiperStatus(err.message);
    }
  };

  const loadElevenVoices = async (apiKey) => {
    if (!apiKey) return;
    setElevenVoicesStatus("loading");
    try {
      const res = await apiFetch("/tts/elevenlabs/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setElevenVoices(data.voices || []);
      setElevenVoicesStatus("");
    } catch (err) {
      setElevenVoices([]);
      setElevenVoicesStatus(err.message);
    }
  };

  // Auto-load ElevenLabs voices when opening settings with a saved key
  useEffect(() => {
    if (settings.ttsProvider === "elevenlabs" && settings.elevenLabsKey) {
      loadElevenVoices(settings.elevenLabsKey);
    }
    if (settings.ttsProvider === "piper") loadPiperVoices();
  }, []);

  useEffect(() => {
    const load = () => setVoices(tts.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    const loadMicDevices = async () => {
      try {
        // Request permission first so labels are populated
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === "audioinput"));
      } catch {
        // Permission denied — list will be empty
      }
    };
    loadMicDevices();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Settings live in this origin's localStorage only, so moving from e.g. the
  // local app to a VPS-hosted instance needs an explicit export/import round trip.
  const [settingsFileStatus, setSettingsFileStatus] = useState(null); // null | {error} | {ok}

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vtamigo-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSettingsFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        // backendUrl isn't exposed anywhere in this UI, so a stale value from
        // an old backup (e.g. a domain this app moved away from) would
        // silently redirect every API call — including login — to a dead
        // origin with no way to notice or clear it. Drop it if it doesn't
        // match where we're actually running.
        let droppedStaleBackendUrl = false;
        if (parsed.backendUrl && parsed.backendUrl.replace(/\/+$/, "") !== window.location.origin) {
          delete parsed.backendUrl;
          droppedStaleBackendUrl = true;
        }
        setForm((f) => ({ ...f, ...parsed }));
        setSettingsFileStatus({ ok: true, droppedStaleBackendUrl });
      } catch (err) {
        setSettingsFileStatus({ error: `Archivo inválido: ${err.message}` });
      }
    };
    reader.onerror = () => setSettingsFileStatus({ error: `No se pudo leer ${file.name}` });
    reader.readAsText(file);
    e.target.value = ""; // allow re-selecting the same file later
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>Settings</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.body}>
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Copiar configuración</h3>
            <div style={styles.field}>
              <label>Exportar / importar toda la configuración</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={exportSettings}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", flex: 1 }}
                >
                  ⬇️ Descargar .json
                </button>
                <label
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    borderRadius: 6,
                  }}
                >
                  ⬆️ Cargar .json
                  <input type="file" accept=".json,application/json" onChange={importSettingsFile} style={{ display: "none" }} />
                </label>
              </div>
              {settingsFileStatus && (
                <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                  {settingsFileStatus.error
                    ? `❌ ${settingsFileStatus.error}`
                    : settingsFileStatus.droppedStaleBackendUrl
                    ? "✅ Configuración cargada (se ignoró un Backend URL de otro dominio guardado en el archivo) — revisa los campos y pulsa Save & Apply para guardarla"
                    : "✅ Configuración cargada — revisa los campos y pulsa Save & Apply para guardarla"}
                </span>
              )}
              <span style={styles.hint}>
                Los ajustes viven en el almacenamiento local del navegador/origen actual, así que no se comparten automáticamente entre el app local y una instancia alojada en el VPS. Descarga aquí, y carga ese archivo en la otra instancia.
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Tunnel client (VTube Studio from another PC)</h3>
            <div style={styles.field}>
              <label>Let a guest run VTube Studio lip-sync from their own computer</label>
              <a href="/downloads/tunnel-client.exe" download style={{ textDecoration: "none" }}>
                <button type="button" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", width: "100%" }}>
                  ⬇️ Download tunnel-client.exe
                </button>
              </a>
              <span style={styles.hint}>
                They run the exe, it shows a short code, and any approved user logs in at /device to approve it — no keys or passwords to share. Same idea as the built-in reverse tunnel, just for a second machine.
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>TikTok Live Connection</h3>
            <div style={styles.field}>
              <label>TikTok username</label>
              <input
                value={form.tiktokUsername || ""}
                onChange={(e) => set("tiktokUsername", e.target.value)}
                placeholder="@username"
              />
              <span style={styles.hint}>
                Enter the TikTok username of the live stream to read chat from (no API key needed — must be live).
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Bot Account (Send to Chat)</h3>
            <div style={styles.field}>
              <label>Bot username</label>
              <input
                value={form.botUsername || ""}
                onChange={(e) => set("botUsername", e.target.value)}
                placeholder="mybotname"
              />
            </div>
            <div style={styles.field}>
              <label>Bot OAuth token</label>
              <input
                type="password"
                value={form.botToken || ""}
                onChange={(e) => set("botToken", e.target.value)}
                placeholder="oauth:xxxxxxxxxxxxxxx"
              />
              <span style={styles.hint}>
                OAuth token for the bot account (needs <code>chat:edit</code> scope). Get one at{" "}
                <a href="https://twitchapps.com/tmi/" target="_blank" rel="noreferrer" style={styles.link}>
                  twitchapps.com/tmi
                </a>
                {" "}while logged in as the bot user.
              </span>
            </div>
            <div style={styles.field}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={!!form.autoSendToChat}
                  onChange={(e) => set("autoSendToChat", e.target.checked)}
                />
                Auto-send AI responses to chat
              </label>
              <span style={styles.hint}>
                When enabled, every AI response is automatically posted to Twitch chat by the bot. You can also send manually with the button in the response panel.
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Ignored Users</h3>
            <div style={styles.field}>
              <label>Ignore messages from (comma-separated)</label>
              <input
                value={form.ignoredUsers || ""}
                onChange={(e) => set("ignoredUsers", e.target.value)}
                placeholder="nightbot, streamelements, jonejo_ia"
              />
              <span style={styles.hint}>
                Messages from these users will be silently dropped (case-insensitive). Bots like Nightbot, StreamElements, etc. are pre-filled.
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Batching</h3>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>Window size (seconds)</label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={form.batchWindow}
                  onChange={(e) => set("batchWindow", Number(e.target.value))}
                />
              </div>
              <div style={styles.field}>
                <label>Max messages per batch</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.maxMessages}
                  onChange={(e) => set("maxMessages", Number(e.target.value))}
                />
              </div>
            </div>
            <div style={styles.field}>
              <label>Response style</label>
              <select value={form.style} onChange={(e) => set("style", e.target.value)}>
                <option value="auto">Auto (context-aware)</option>
                <option value="chatbot">Chatbot (address chat directly)</option>
                <option value="narrator">Narrator (color commentator)</option>
              </select>
            </div>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>Historias de Reddit <span style={styles.comingSoon}>(deshabilitado por ahora)</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="idleReddit"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="idleReddit" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  Contar una historia cuando el chat está inactivo
                </label>
              </div>
              <div style={styles.field}>
                <label>Contar una historia cada N batches vacíos</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.idleStoryThreshold ?? 7}
                  onChange={(e) => set("idleStoryThreshold", Number(e.target.value))}
                />
                <span style={styles.hint}>
                  Ej: 7 = leer una historia cada 7 veces que el temporizador se dispara sin mensajes (~{Math.round((form.idleStoryThreshold ?? 7) * (form.batchWindow ?? 20) / 60)} min con ventana de {form.batchWindow ?? 20}s).
                </span>
              </div>
              <div style={styles.field}>
                <label>Subreddits (separados por coma)</label>
                <input
                  value={form.subreddits ?? "HistoriasDeReddit, AskRedditEsp, confesiones, anecdotasgraciosas, es"}
                  onChange={(e) => set("subreddits", e.target.value)}
                  placeholder="HistoriasDeReddit, AskRedditEsp, es"
                />
                <span style={styles.hint}>Solo subreddits públicos con posts de texto en español.</span>
              </div>
            </fieldset>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>YouTube Peek <span style={styles.comingSoon}>(deshabilitado por ahora)</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="youtubePeek"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="youtubePeek" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  Narrar periódicamente lo que hay en la pestaña de YouTube
                </label>
              </div>
              <div style={styles.field}>
                <label>Intervalo (minutos)</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={form.youtubePeekInterval ?? 5}
                  onChange={(e) => set("youtubePeekInterval", Number(e.target.value))}
                />
                <span style={styles.hint}>
                  Claude mirará la pestaña de YouTube cada {form.youtubePeekInterval ?? 5} minuto{(form.youtubePeekInterval ?? 5) !== 1 ? "s" : ""} y narrará lo que ve.
                  Requiere la extensión Claude in Chrome activa.
                </span>
              </div>
            </fieldset>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>Preguntas en Pantalla (Trivia) <span style={styles.comingSoon}>(deshabilitado por ahora)</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="screenWatch"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenWatch" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  Detectar preguntas en pantalla y responder con ayuda del chat
                </label>
              </div>
              <div style={styles.row2}>
                <div style={styles.field}>
                  <label>Captura cada (segundos)</label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={form.screenWatchInterval ?? 4}
                    onChange={(e) => set("screenWatchInterval", Number(e.target.value))}
                  />
                </div>
                <div style={styles.field}>
                  <label>Esperar al chat (segundos)</label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={form.screenWatchWindow ?? 20}
                    onChange={(e) => set("screenWatchWindow", Number(e.target.value))}
                  />
                </div>
              </div>
              <div style={styles.field}>
                <label>Programa a capturar (opcional): nombre del ejecutable</label>
                <input
                  value={form.screenWatchProcess || ""}
                  onChange={(e) => set("screenWatchProcess", e.target.value)}
                  placeholder="TriviaGame.exe — vacío = monitor principal"
                />
                <span style={styles.hint}>
                  Captura solo la ventana de ese programa, aunque esté detrás de otras ventanas. Si el juego aún no está
                  abierto, espera a que se abra.
                </span>
              </div>
              <div style={styles.field}>
                <label>Región de captura (opcional): x,y,ancho,alto</label>
                <input
                  value={form.screenWatchRegion || ""}
                  onChange={(e) => set("screenWatchRegion", e.target.value)}
                  placeholder="0,0,1920,1080 — vacío = todo"
                />
                <span style={styles.hint}>
                  Limita la captura a la zona donde aparecen las preguntas (menos falsos positivos y análisis más barato).
                  Con un programa elegido, la región es relativa a su ventana; si no, al monitor principal.
                  Detecta texto con OCR local (gratis) y solo usa la IA (haiku) cuando parece haber una pregunta.
                  Al detectarla, espera la ventana de chat y responde teniendo en cuenta los votos.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="screenClick"
                  checked={form.screenClickEnabled || false}
                  onChange={(e) => set("screenClickEnabled", e.target.checked)}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenClick" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  Clic automático en la respuesta elegida
                </label>
              </div>
              <div style={styles.field}>
                <label>Hacer clic en</label>
                <select
                  value={form.screenClickTarget || "ai"}
                  onChange={(e) => set("screenClickTarget", e.target.value)}
                >
                  <option value="ai">La respuesta de la IA</option>
                  <option value="chat">La más votada por el chat (si hay votos)</option>
                </select>
                <span style={styles.hint}>
                  Localiza el texto de la opción en pantalla con OCR y hace clic sobre ella (trae la ventana del juego al
                  frente). Después espera 3–5 segundos y hace clic de nuevo en el mismo punto para pasar a la siguiente pregunta.
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  id="screenAutoNav"
                  checked={form.screenAutoNavigate || false}
                  onChange={(e) => set("screenAutoNavigate", e.target.checked)}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenAutoNav" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  Navegación automática entre rondas (Majotori)
                </label>
              </div>
              <div style={styles.field}>
                <span style={styles.hint}>
                  Al detectar la pantalla de resultados hace clics hasta volver al menú principal, ahí pulsa
                  «Jugar», luego «Solo Trivia» y un clic más para llegar a la siguiente pregunta.
                </span>
              </div>
              <div style={styles.field}>
                <button
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", width: "100%" }}
                  type="button"
                  onClick={() => {
                    apiFetch("/screenwatch/test", { method: "POST" }).catch(() => {});
                    onClose();
                  }}
                >
                  🖥️ Probar con una pregunta de ejemplo
                </button>
              </div>
            </fieldset>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>AI Provider</h3>
            <div style={{ ...styles.disabledSection, marginBottom: 12 }}>
            <fieldset disabled style={styles.disabledFieldset}>
            <div style={styles.field}>
              <label>Provider <span style={styles.comingSoon}>(solo Claude disponible por ahora)</span></label>
              <select value="claude" onChange={() => {}}>
                <option value="claude">Claude (claude -p)</option>
                <option value="grok">Grok (grok -p)</option>
                <option value="agy">AGY CLI (agy -p)</option>
                <option value="chatgpt">ChatGPT (OpenAI API)</option>
              </select>
            </div>
            {(() => {
              const current = form.provider || "claude";
              const targets = ["claude", "grok", "agy"].filter((p) => p !== current);
              const target = targets.includes(exportTarget) ? exportTarget : targets[0];
              const canExport = current !== "chatgpt" && !exportStatus?.running;
              const label = (p) => p.charAt(0).toUpperCase() + p.slice(1);
              return (
                <div style={styles.field}>
                  <label>Exportar memoria del modelo actual</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={target || ""}
                      onChange={(e) => setExportTarget(e.target.value)}
                      disabled={!canExport}
                      style={{ flex: 1 }}
                    >
                      {targets.map((p) => (
                        <option key={p} value={p}>{label(p)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => startMemoryExport(current, target)}
                      disabled={!canExport || !target}
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        opacity: !canExport || !target ? 0.5 : 1,
                      }}
                    >
                      {exportStatus?.running ? "Exportando…" : `📤 Exportar a ${label(target || "")}`}
                    </button>
                  </div>
                  {exportStatus && (exportStatus.running || exportStatus.pct > 0 || exportStatus.error) && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          height: 10,
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${exportStatus.pct || 0}%`,
                            background: exportStatus.error ? "#e05555" : "var(--purple)",
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                      <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                        {exportStatus.error
                          ? `❌ ${exportStatus.error}`
                          : exportStatus.pct >= 100
                          ? `✅ ${exportStatus.stage}${exportStatus.mdPath ? ` — guardada en ${exportStatus.mdPath}` : ""}`
                          : `${exportStatus.stage} (${exportStatus.pct || 0}%)`}
                      </span>
                    </div>
                  )}
                  <span style={styles.hint}>
                    Copia la memoria de la sesión del modelo seleccionado al otro modelo (se guarda también como .md en
                    backend/memories/). ChatGPT no tiene sesión persistente, así que no participa.
                  </span>
                </div>
              );
            })()}
            </fieldset>
            </div>
            {(() => {
              const current = "claude";
              const canImport = !!importFile && !importStatus?.running;
              return (
                <div style={styles.field}>
                  <label>Importar memoria desde archivo .md</label>
                  <input type="file" accept=".md,text/markdown" onChange={handleMemoryFile} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => importMemoryFile(current)}
                      disabled={!canImport}
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        opacity: !canImport ? 0.5 : 1,
                        flex: 1,
                      }}
                    >
                      {importStatus?.running
                        ? "Importando…"
                        : `📥 Cargar${importFile ? ` "${importFile.name}"` : ""} en la sesión actual`}
                    </button>
                  </div>
                  {importStatus && (importStatus.error || importStatus.ok) && (
                    <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                      {importStatus.error ? `❌ ${importStatus.error}` : "✅ Memoria integrada en la sesión"}
                    </span>
                  )}
                  <span style={styles.hint}>
                    Carga un archivo .md (por ejemplo uno exportado antes) como recuerdos del modelo seleccionado
                    arriba, en su sesión guardada actual. ChatGPT no tiene sesión persistente, así que no participa.
                  </span>
                </div>
              );
            })()}
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Prompt de IA</h3>
            <div style={styles.field}>
              <label>Prompt base (se añaden los mensajes del chat al final automáticamente)</label>
              <textarea
                value={form.basePrompt || ""}
                onChange={(e) => set("basePrompt", e.target.value)}
                rows={7}
                style={styles.textarea}
              />
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Text-to-Speech</h3>
            <div style={styles.field}>
              <label>TTS Provider</label>
              <select
                value={form.ttsProvider || "windows"}
                onChange={(e) => {
                  set("ttsProvider", e.target.value);
                  if (e.target.value === "piper") loadPiperVoices();
                }}
              >
                <option value="windows">Windows TTS (system voices)</option>
                <option value="elevenlabs">ElevenLabs (API key required)</option>
                <option value="piper">Piper (local Spanish voices, offline)</option>
              </select>
            </div>
            {(form.ttsProvider || "windows") === "windows" && (
              <div style={styles.field}>
                <label>Voice</label>
                <select value={form.voiceURI} onChange={(e) => set("voiceURI", e.target.value)}>
                  <option value="">System default</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.ttsProvider === "elevenlabs" && (
              <>
                <div style={styles.field}>
                  <label>ElevenLabs API key</label>
                  <input
                    type="password"
                    value={form.elevenLabsKey || ""}
                    onChange={(e) => set("elevenLabsKey", e.target.value)}
                    onBlur={() => loadElevenVoices(form.elevenLabsKey)}
                    placeholder="sk_xxxxxxxxxxxxxxxxxxxx"
                  />
                  <span style={styles.hint}>
                    Get one at{" "}
                    <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" style={styles.link}>
                      elevenlabs.io
                    </a>
                    {" "}— stored locally, only sent to the local backend. Falls back to Windows TTS if generation fails.
                  </span>
                </div>
                <div style={styles.field}>
                  <label>ElevenLabs voice</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={form.elevenLabsVoiceId || ""}
                      onChange={(e) => set("elevenLabsVoiceId", e.target.value)}
                      style={{ flex: 1 }}
                    >
                      <option value="">— select a voice —</option>
                      {elevenVoices.map((v) => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}{v.category ? ` (${v.category})` : ""}
                        </option>
                      ))}
                      {form.elevenLabsVoiceId && !elevenVoices.some((v) => v.voice_id === form.elevenLabsVoiceId) && (
                        <option value={form.elevenLabsVoiceId}>{form.elevenLabsVoiceId} (saved)</option>
                      )}
                    </select>
                    <button
                      type="button"
                      style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                      onClick={() => loadElevenVoices(form.elevenLabsKey)}
                      disabled={!form.elevenLabsKey || elevenVoicesStatus === "loading"}
                    >
                      {elevenVoicesStatus === "loading" ? "Loading…" : "↻ Load voices"}
                    </button>
                  </div>
                  {elevenVoicesStatus && elevenVoicesStatus !== "loading" && (
                    <span style={{ ...styles.hint, color: "var(--red)" }}>⚠ {elevenVoicesStatus}</span>
                  )}
                </div>
                <div style={styles.field}>
                  <label>Or paste a voice ID directly</label>
                  <input
                    value={form.elevenLabsVoiceId || ""}
                    onChange={(e) => set("elevenLabsVoiceId", e.target.value.trim())}
                    placeholder="21m00Tcm4TlvDq8ikWAM"
                  />
                  <span style={styles.hint}>
                    Useful for library/shared voices that don't appear in "My voices". Find the ID in ElevenLabs → Voices → ⋯ → Copy voice ID.
                  </span>
                </div>
              </>
            )}
            {form.ttsProvider === "piper" && (
              <div style={styles.field}>
                <label>Piper voice</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={form.piperVoice || ""}
                    onChange={(e) => set("piperVoice", e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Default (es_MX claude, high quality)</option>
                    {piperVoices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                    onClick={loadPiperVoices}
                    disabled={piperStatus === "loading"}
                  >
                    {piperStatus === "loading" ? "Loading…" : "↻ Load voices"}
                  </button>
                </div>
                {piperStatus === "missing" && (
                  <span style={{ ...styles.hint, color: "var(--red)" }}>⚠ piper.exe not found in projects\piperttsspanish</span>
                )}
                {piperStatus && !["loading", "ok", "missing"].includes(piperStatus) && (
                  <span style={{ ...styles.hint, color: "var(--red)" }}>⚠ {piperStatus}</span>
                )}
                <span style={styles.hint}>
                  Runs fully offline on CPU — no API key or server needed. Falls back to Windows TTS if generation fails.
                </span>
              </div>
            )}
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>Speed ({form.ttsRate}x)</label>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={form.ttsRate}
                  onChange={(e) => set("ttsRate", Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--purple)" }}
                />
              </div>
              <div style={styles.field}>
                <label>Volume ({Math.round(form.ttsVolume * 100)}%)</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.ttsVolume}
                  onChange={(e) => set("ttsVolume", Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--purple)" }}
                />
              </div>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Voice Transcription (Mic)</h3>
            {!voice.supported && (
              <p style={{ ...styles.hint, color: "var(--red)", marginBottom: 10 }}>
                ⚠ SpeechRecognition not supported in this browser. Use Chromium/Chrome.
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="micEnabled"
                checked={form.micEnabled || false}
                onChange={(e) => set("micEnabled", e.target.checked)}
                style={{ width: "auto", accentColor: "var(--purple)" }}
                disabled={!voice.supported}
              />
              <label htmlFor="micEnabled" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                Transcribe mic and include in Claude batches
              </label>
            </div>
            <div style={styles.field}>
              <label>Microphone device</label>
              <select
                value={form.micDeviceId || ""}
                onChange={(e) => set("micDeviceId", e.target.value)}
                disabled={!voice.supported}
              >
                <option value="">System default</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>Language</label>
                <select
                  value={form.micLang || "es-ES"}
                  onChange={(e) => set("micLang", e.target.value)}
                  disabled={!voice.supported}
                >
                  <option value="es-ES">Español (ES)</option>
                  <option value="es-MX">Español (MX)</option>
                  <option value="es-AR">Español (AR)</option>
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (GB)</option>
                  <option value="pt-BR">Português (BR)</option>
                  <option value="fr-FR">Français</option>
                  <option value="de-DE">Deutsch</option>
                </select>
              </div>
              <div style={styles.field}>
                <label>Label in chat</label>
                <input
                  value={form.micLabel || "Streamer"}
                  onChange={(e) => set("micLabel", e.target.value)}
                  placeholder="Streamer"
                  disabled={!voice.supported}
                />
                <span style={styles.hint}>Name shown for your voice messages in the chat feed.</span>
              </div>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>VTube Studio — Lip Sync</h3>
            <div style={styles.field}>
              <label>WebSocket URL</label>
              <input
                value={form.vtubeUrl || "ws://localhost:8001"}
                onChange={(e) => set("vtubeUrl", e.target.value)}
                placeholder="ws://localhost:8001"
              />
              <span style={styles.hint}>
                Enable Plugin API in VTube Studio → Settings → General, then make sure the port matches.
              </span>
            </div>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>Plugin name</label>
                <input
                  value={form.vtubePlugin || "Twitch Chat Bot"}
                  onChange={(e) => set("vtubePlugin", e.target.value)}
                  placeholder="Twitch Chat Bot"
                />
              </div>
              <div style={styles.field}>
                <label>Mouth parameter (VTS tracking param)</label>
                <input
                  value={form.vtubeMouthParam || "MouthOpen"}
                  onChange={(e) => set("vtubeMouthParam", e.target.value)}
                  placeholder="MouthOpen"
                />
                <span style={styles.hint}>Use VTS face-tracking input names (MouthOpen, MouthSmile…), not Live2D parameter names.</span>
              </div>
            </div>
            <div style={styles.field}>
              <label>Mouth sensitivity ({Math.round((form.vtubeSensitivity ?? 0.8) * 100)}%)</label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={form.vtubeSensitivity ?? 0.8}
                onChange={(e) => set("vtubeSensitivity", Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--purple)" }}
              />
              <span style={styles.hint}>
                50% = subtle movement · 100% = full range
              </span>
            </div>
            <div style={styles.field}>
              <button
                style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", width: "100%" }}
                type="button"
                onClick={() => {
                  apiFetch("/lipsync/start", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: "aaa ooo eee aaa ooo aaa", durationMs: 1200 }),
                  }).catch(() => {});
                }}
              >
                Test mouth animation
              </button>
            </div>
          </section>
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.saveBtn} onClick={() => onSave(form)}>Save & Apply</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  textarea: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 13,
    width: "100%",
    resize: "vertical",
    lineHeight: 1.6,
  },
  disabledSection: {
    opacity: 0.45,
  },
  disabledFieldset: {
    border: "none",
    padding: 0,
    margin: 0,
  },
  comingSoon: {
    fontSize: 10,
    fontWeight: 400,
    color: "var(--text-muted)",
    textTransform: "none",
    letterSpacing: "normal",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    width: 520,
    maxWidth: "95vw",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
  },
  title: {
    fontWeight: 700,
    fontSize: 16,
  },
  closeBtn: {
    background: "transparent",
    color: "var(--text-muted)",
    padding: "4px 8px",
    fontSize: 16,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  section: {},
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--purple-light)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 4,
    display: "block",
  },
  link: {
    color: "var(--purple-light)",
  },
  footer: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
  },
  cancelBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
  },
  saveBtn: {
    background: "var(--purple)",
    color: "#fff",
  },
};
