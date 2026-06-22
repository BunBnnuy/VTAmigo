import React, { useState, useEffect } from "react";
import { tts } from "./TTSController.js";
import { voice } from "./VoiceTranscription.js";

export default function Settings({ settings, onSave, onClose }) {
  const [form, setForm] = useState(settings);
  const [voices, setVoices] = useState([]);
  const [micDevices, setMicDevices] = useState([]);

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
            <h3 style={styles.sectionTitle}>AI Provider</h3>
            <div style={styles.field}>
              <label>Provider</label>
              <select value={form.provider || "claude"} onChange={(e) => set("provider", e.target.value)}>
                <option value="claude">Claude (claude -p)</option>
                <option value="grok">Grok (grok -p)</option>
              </select>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Prompt de Claude</h3>
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
