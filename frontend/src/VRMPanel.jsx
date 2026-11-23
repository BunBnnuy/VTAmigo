import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Play, Save, Upload, X } from "lucide-react";
import { apiFetch, apiUrl } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Human-readable size for the upload progress line. No cap is applied: the
// owner's VRM can be several hundred MB and the server streams it to disk.
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

// One 8 MB chunk. XHR (not fetch) because only XHR exposes upload progress,
// and each chunk is retried by the caller without restarting the whole file.
function putChunk(url, blob, onProgress, xhrRef) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    };
    xhr.onload = () => {
      xhrRef.current = null;
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* nginx/proxy error page */
      }
      reject(new Error(data?.error || `HTTP ${xhr.status}`));
    };
    xhr.onerror = () => {
      xhrRef.current = null;
      reject(new Error("network"));
    };
    xhr.onabort = () => {
      xhrRef.current = null;
      reject(new Error("aborted"));
    };
    const form = new FormData();
    form.append("file", blob, "chunk");
    xhr.send(form);
  });
}

// Control window for the standalone VRM lab and its OBS overlay. Everything
// here is the same config the lab itself reads/writes (GET/POST /vrm-lab/config),
// so changes made in either place show up in the other on next load.
export default function VRMPanel({ lang }) {
  const { t } = useTranslation(lang);

  const [config, setConfig] = useState(null);
  const [idleClips, setIdleClips] = useState([]);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [ttsOutput, setTtsOutput] = useState("app");
  const [testStatus, setTestStatus] = useState("");
  // VRM upload: null = idle/done, 0..1 = in flight. XHR (not fetch) because
  // only XHR exposes upload progress events for a 250 MB+ body.
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadDone, setUploadDone] = useState(false);
  const fileInputRef = useRef(null);
  const xhrRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/vrm-lab/config").then((res) => (res.ok ? res.json() : null)),
      fetch("/vrm-lab/animations.json").then((res) => (res.ok ? res.json() : [])),
      apiFetch("/overlay/avatar/overlay-url").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([cfg, clips, overlay]) => {
        if (cancelled) return;
        if (cfg) {
          setConfig(cfg);
          setModelDraft(cfg.modelUrl || "");
        }
        setIdleClips((clips || []).filter((clip) => clip.category === "idle"));
        if (overlay?.token) {
          setOverlayUrl(
            `${window.location.origin}/vrm-overlay.html?token=${encodeURIComponent(overlay.token)}`
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The app keeps its settings in localStorage, so the panel can read the voice
  // output directly and warn when the overlay would receive nothing.
  useEffect(() => {
    const read = () => {
      try {
        const saved = JSON.parse(localStorage.getItem("settings") || "{}");
        setTtsOutput(saved.ttsOutput || "app");
      } catch {
        setTtsOutput("app");
      }
    };
    read();
    const timer = window.setInterval(read, 3000);
    window.addEventListener("focus", read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, []);

  const save = useCallback(async (patch) => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await apiFetch("/vrm-lab/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setConfig(data);
      setModelDraft(data.modelUrl || "");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, []);

  // Fires the same tts_speak broadcast the bot uses, so the overlay can be
  // tested without waiting for an AI line. The voice fields mirror the app's
  // settings (localStorage is the client's source of truth).
  const testOverlay = useCallback(async () => {
    setTestStatus("");
    try {
      const saved = JSON.parse(localStorage.getItem("settings") || "{}");
      const res = await apiFetch("/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hola, esta es una prueba del overlay VRM.",
          voiceURI: saved.voiceURI || null,
          piperVoice: saved.piperVoice || null,
          kittenVoice: saved.kittenVoice || null,
          kokoroVoice: saved.kokoroVoice || null,
          fishVoice: saved.fishVoice || null,
          ttsProvider: saved.ttsProvider || "windows",
          rate: saved.ttsRate || 1,
          volume: saved.ttsVolume != null ? saved.ttsVolume : 1,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTestStatus("ok");
      window.setTimeout(() => setTestStatus(""), 2000);
    } catch (err) {
      setTestStatus(err.message);
    }
  }, []);

  const copyOverlay = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the input is selectable when the clipboard API is unavailable */
    }
  }, [overlayUrl]);

  // ── VRM file upload ──────────────────────────────────────────────────────
  // Owner-only on the backend too. XHR is deliberate: fetch() has no upload
  // progress in every browser, and this body can be several hundred MB.
  const pickFile = useCallback((event) => {
    const file = event.target.files?.[0] || null;
    setUploadError("");
    setUploadDone(false);
    setUploadPct(null);
    setUploadSpeed("");
    if (!file) {
      setUploadFile(null);
      return;
    }
    if (!/\.vrm$/i.test(file.name)) {
      setUploadFile(null);
      setUploadError(t("vrmPanel.uploadInvalid"));
      if (event.target) event.target.value = "";
      return;
    }
    setUploadFile(file);
  }, [t]);

  const startUpload = useCallback(async () => {
    if (!uploadFile || uploadPct !== null) return;
    setUploadError("");
    setUploadDone(false);
    setUploadPct(0);
    setUploadSpeed("");
    cancelledRef.current = false;
    const startedAt = Date.now();
    const size = uploadFile.size;
    let uploadId = null;
    try {
      // 1. Declare the size first: the server checks free disk before any byte
      //    is streamed, then hands back the chunk plan.
      const initRes = await apiFetch("/vrm-lab/model/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size, name: uploadFile.name }),
      });
      const init = await initRes.json().catch(() => ({}));
      if (!initRes.ok) throw new Error(init.error || `HTTP ${initRes.status}`);
      uploadId = init.uploadId;
      const { chunkSize, chunks } = init;

      // 2. Upload 8 MB pieces. A failed piece is retried twice in place.
      for (let index = 0; index < chunks; index++) {
        if (cancelledRef.current) throw new Error("aborted");
        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, size);
        const blob = uploadFile.slice(start, end);
        let attempt = 0;
        for (;;) {
          try {
            await putChunk(
              apiUrl(`/vrm-lab/model/chunk/${uploadId}/${index}`),
              blob,
              (loaded) => {
                const overall = start + loaded;
                setUploadPct(Math.min(1, overall / size));
                const seconds = Math.max(0.2, (Date.now() - startedAt) / 1000);
                setUploadSpeed(`${formatBytes(overall / seconds)}/s`);
              },
              xhrRef
            );
            break;
          } catch (err) {
            if (cancelledRef.current || err.message === "aborted") throw err;
            if (attempt >= 2) throw err;
            attempt += 1;
          }
        }
      }

      // 3. Assemble + validate on the server, then point the config at it.
      const doneRes = await apiFetch("/vrm-lab/model/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId }),
      });
      const done = await doneRes.json().catch(() => ({}));
      if (!doneRes.ok) throw new Error(done.error || `HTTP ${doneRes.status}`);
      const url = apiUrl(done.url);
      setUploadPct(1);
      setUploadDone(true);
      setUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setModelDraft(url);
      save({ modelUrl: url });
    } catch (err) {
      // Drop partial chunks so an abandoned/failed upload cannot fill the
      // disk. This also runs for a user cancel.
      if (uploadId) {
        apiFetch("/vrm-lab/model/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        }).catch(() => {});
      }
      setUploadPct(null);
      setUploadSpeed("");
      setUploadDone(false);
      if (err.message === "aborted") return;
      setUploadError(err.message === "network" ? t("vrmPanel.uploadNetworkError") : err.message);
    }
  }, [uploadFile, uploadPct, save, t]);

  const cancelUpload = useCallback(() => {
    cancelledRef.current = true;
    if (xhrRef.current) xhrRef.current.abort();
  }, []);

  useEffect(() => () => {
    cancelledRef.current = true;
    if (xhrRef.current) xhrRef.current.abort();
  }, []);

  return (
    <div style={styles.body}>
      <div style={styles.row}>
        <a style={styles.secondaryBtn} href="/vrm-lab.html" target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> {t("vrmPanel.openLab")}
        </a>
        <span style={styles.status}>
          {saving ? <Loader2 size={13} className="spin" /> : saved ? <Check size={13} /> : null}
          {saved ? t("vrmPanel.saved") : ""}
        </span>
      </div>

      <div style={styles.uploadBox}>
        <label style={styles.label}>
          {t("vrmPanel.upload")}
          <input
            ref={fileInputRef}
            type="file"
            accept=".vrm,model/gltf-binary,application/octet-stream"
            onChange={pickFile}
            style={styles.fileInput}
          />
        </label>
        <span style={styles.hint}>{t("vrmPanel.uploadHint")}</span>
        {uploadFile && (
          <span style={styles.selectedFile}>
            {uploadFile.name} · {formatBytes(uploadFile.size)}
          </span>
        )}
        {uploadPct !== null && !uploadDone && (
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${Math.round(uploadPct * 100)}%` }} />
          </div>
        )}
        {uploadPct !== null && !uploadDone && uploadFile && (
          <span style={styles.hint}>
            {Math.round(uploadPct * 100)}% · {formatBytes(uploadFile.size * uploadPct)} / {formatBytes(uploadFile.size)}
            {uploadSpeed ? ` · ${uploadSpeed}` : ""}
          </span>
        )}
        <div style={styles.row}>
          <button
            style={{ ...styles.primaryBtn, flex: 1 }}
            onClick={startUpload}
            disabled={!uploadFile || (uploadPct !== null && !uploadDone)}
          >
            <Upload size={13} /> {uploadPct !== null && !uploadDone ? t("vrmPanel.uploading") : t("vrmPanel.uploadBtn")}
          </button>
          {uploadPct !== null && !uploadDone && (
            <button style={{ ...styles.secondaryBtn, width: "auto" }} onClick={cancelUpload}>
              <X size={13} /> {t("vrmPanel.cancel")}
            </button>
          )}
        </div>
        {uploadDone && (
          <span style={styles.uploadDone}>
            <Check size={13} /> {t("vrmPanel.uploadDone")}
          </span>
        )}
        {uploadError && <span style={styles.error}>{uploadError}</span>}
      </div>

      <label style={styles.label}>
        {t("vrmPanel.model")}
        <input
          type="url"
          value={modelDraft}
          placeholder={t("vrmPanel.modelPlaceholder")}
          onChange={(e) => setModelDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save({ modelUrl: modelDraft.trim() })}
        />
      </label>      <button
        style={styles.primaryBtn}
        onClick={() => save({ modelUrl: modelDraft.trim() })}
        disabled={saving}
      >
        <Save size={13} /> {t("vrmPanel.save")}
      </button>

      <label style={styles.label}>
        {t("vrmPanel.idle")}
        <select
          value={config?.idleClip || ""}
          onChange={(e) => save({ idleClip: e.target.value })}
          disabled={saving || !config}
        >
          <option value="">{t("vrmPanel.idleProcedural")}</option>
          {idleClips.map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.label}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.checkRow}>
        <input
          type="checkbox"
          checked={config?.autoClips !== false}
          onChange={(e) => save({ autoClips: e.target.checked })}
          disabled={saving || !config}
        />
        {t("vrmPanel.autoClips")}
      </label>
      <label style={styles.checkRow}>
        <input
          type="checkbox"
          checked={!!config?.varyIdle}
          onChange={(e) => save({ varyIdle: e.target.checked })}
          disabled={saving || !config}
        />
        {t("vrmPanel.varyIdle")}
      </label>

      <label style={styles.label}>
        {t("vrmPanel.overlay")}
        <span style={styles.row}>
          <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} />
          <button style={styles.secondaryBtn} onClick={copyOverlay} disabled={!overlayUrl}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("vrmPanel.copied") : t("vrmPanel.copy")}
          </button>
        </span>
      </label>
      <div style={styles.row}>
        <a
          style={{ ...styles.secondaryBtn, flex: 1 }}
          href={overlayUrl ? `${overlayUrl}&debug=1` : "#"}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> {t("vrmPanel.openDebug")}
        </a>
        <button style={styles.secondaryBtn} onClick={testOverlay}>
          {testStatus === "ok" ? <Check size={13} /> : <Play size={13} />}
          {testStatus === "ok" ? t("vrmPanel.testSent") : t("vrmPanel.testOverlay")}
        </button>
      </div>
      {testStatus && testStatus !== "ok" && <span style={styles.error}>{testStatus}</span>}

      {ttsOutput === "app" && (
        <span style={styles.warn}>{t("vrmPanel.outputWarning")}</span>
      )}
      {error && <span style={styles.error}>{error}</span>}
      <span style={styles.hint}>{t("vrmPanel.troubleshoot")}</span>
      <span style={styles.hint}>{t("vrmPanel.hint")}</span>
    </div>
  );
}

const styles = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    height: "100%",
    overflowY: "auto",
    fontSize: 12,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 11.5,
    color: "var(--text-muted)",
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 11.5,
    lineHeight: 1.4,
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--green)",
    marginLeft: "auto",
  },
  primaryBtn: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    borderRadius: 9,
    padding: "6px 10px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  secondaryBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "6px 10px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  hint: {
    fontSize: 10.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  },
  uploadBox: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: 8,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 9,
  },
  fileInput: {
    width: "100%",
    fontSize: 11,
    color: "var(--text-muted)",
  },
  selectedFile: {
    fontSize: 11,
    color: "var(--text)",
    wordBreak: "break-all",
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    background: "var(--border)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    background: "var(--accent)",
    transition: "width .2s ease",
  },
  uploadDone: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    fontSize: 11,
    color: "var(--green)",
  },
  error: {
    fontSize: 11,
    color: "var(--red)",
  },
  warn: {
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--yellow)",
  },
};
