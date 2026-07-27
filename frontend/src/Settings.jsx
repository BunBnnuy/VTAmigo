import React, { useState, useEffect } from "react";
import { tts } from "./TTSController.js";
import { voice } from "./VoiceTranscription.js";

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState(settings);
  const [voices, setVoices] = useState([]);
  const [micDevices, setMicDevices] = useState([]);
  const [newExtraChannel, setNewExtraChannel] = useState("");

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

  const addExtraChannel = () => {
    const ch = newExtraChannel.toLowerCase().replace(/^#/, "").trim();
    if (!ch || (form.extraChannels || []).includes(ch)) return;
    set("extraChannels", [...(form.extraChannels || []), ch]);
    setNewExtraChannel("");
  };

  const removeExtraChannel = (ch) => {
    set("extraChannels", (form.extraChannels || []).filter((c) => c !== ch));
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
            <h3 style={styles.sectionTitle}>Twitch Connection</h3>
            <div style={styles.field}>
              <label>Channel name</label>
              <input
                value={form.channel}
                onChange={(e) => set("channel", e.target.value)}
                placeholder="xqc"
              />
            </div>
            <div style={styles.field}>
              <label>OAuth Token (requerido para canjes de puntos y evitar rate limits)</label>
              <input
                type="password"
                value={form.token}
                onChange={(e) => set("token", e.target.value)}
                placeholder="oauth:xxxxxxxxxxxxxxx"
              />
              <span style={styles.hint}>
                Obtén uno en{" "}
                <a
                  href="https://twitchapps.com/tmi/"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  twitchapps.com/tmi
                </a>
                {" "}— asegúrate de tener el scope <code>channel:read:redemptions</code>
              </span>
            </div>
            <div style={styles.field}>
              <label>Client-ID de Twitch (necesario para canjes silenciosos vía EventSub)</label>
              <input
                value={form.clientId || ""}
                onChange={(e) => set("clientId", e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
              <span style={styles.hint}>
                Regístra una app gratis en{" "}
                <a
                  href="https://dev.twitch.tv/console/apps/create"
                  target="_blank"
                  rel="noreferrer"
                  style={styles.link}
                >
                  dev.twitch.tv/console
                </a>
                {" "}→ copia el Client-ID. URL de redirección: <code>http://localhost</code>
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Extra Channels</h3>
            <div style={styles.field}>
              <label>Add channel to read & send</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newExtraChannel}
                  onChange={(e) => setNewExtraChannel(e.target.value)}
                  placeholder="channelname"
                  onKeyDown={(e) => e.key === "Enter" && addExtraChannel()}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={addExtraChannel}
                  style={{ background: "var(--purple)", color: "#fff", padding: "0 14px", flexShrink: 0 }}
                >
                  Add
                </button>
              </div>
              {(form.extraChannels || []).length > 0 && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  {(form.extraChannels || []).map((ch) => (
                    <div key={ch} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg)", borderRadius: 6, padding: "5px 10px", border: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 13, color: "var(--text)" }}>#{ch}</span>
                      <button
                        type="button"
                        onClick={() => removeExtraChannel(ch)}
                        style={{ background: "transparent", color: "var(--text-muted)", padding: "2px 6px", fontSize: 14 }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <span style={styles.hint}>
                Reads chat from these channels and sends bot responses there too (uses the same bot credentials). Messages appear tagged with the channel name.
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

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Historias de Reddit</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="idleReddit"
                checked={form.idleRedditStories !== false}
                onChange={(e) => set("idleRedditStories", e.target.checked)}
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
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>YouTube Peek</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="youtubePeek"
                checked={form.youtubePeekEnabled || false}
                onChange={(e) => set("youtubePeekEnabled", e.target.checked)}
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
                disabled={!form.youtubePeekEnabled}
              />
              <span style={styles.hint}>
                Claude mirará la pestaña de YouTube cada {form.youtubePeekInterval ?? 5} minuto{(form.youtubePeekInterval ?? 5) !== 1 ? "s" : ""} y narrará lo que ve.
                Requiere la extensión Claude in Chrome activa.
              </span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Preguntas en Pantalla (Trivia)</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="screenWatch"
                checked={form.screenWatchEnabled || false}
                onChange={(e) => set("screenWatchEnabled", e.target.checked)}
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
                  disabled={!form.screenWatchEnabled}
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
                  disabled={!form.screenWatchEnabled}
                />
              </div>
            </div>
            <div style={styles.field}>
              <label>Programa a capturar (opcional): nombre del ejecutable</label>
              <input
                value={form.screenWatchProcess || ""}
                onChange={(e) => set("screenWatchProcess", e.target.value)}
                placeholder="TriviaGame.exe — vacío = monitor principal"
                disabled={!form.screenWatchEnabled}
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
                disabled={!form.screenWatchEnabled}
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
                disabled={!form.screenWatchEnabled}
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
                disabled={!form.screenWatchEnabled || !form.screenClickEnabled}
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
                disabled={!form.screenWatchEnabled}
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
                  fetch("/screenwatch/test", { method: "POST" }).catch(() => {});
                  onClose();
                }}
              >
                🖥️ Probar con una pregunta de ejemplo
              </button>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>AI Provider</h3>
            <div style={styles.field}>
              <label>Provider</label>
              <select value={form.provider || "claude"} onChange={(e) => set("provider", e.target.value)}>
                <option value="claude">Claude (claude -p)</option>
                <option value="grok">Grok (grok -p)</option>
                <option value="chatgpt">ChatGPT (OpenAI API)</option>
              </select>
            </div>
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
                  fetch("/lipsync/start", {
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
