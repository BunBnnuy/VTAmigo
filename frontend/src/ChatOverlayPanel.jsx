import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch, apiUrl } from "./api.js";
import { useTranslation } from "./i18n/index.js";

const DEFAULTS = {
  theme: "default",
  max: 25, fade: 0, showEvents: true, showBanner: true, bannerDuration: 6000,
  showRedeems: true, showBotMessages: true, direction: "up", align: "left",
  timestamps: false, userColor: true, animate: true, lang: "en", width: 420,
  maxHeight: 600, fontsize: 16, bg: 0.35, textcolor: "ffffff", fontFamily: "",
  bgImageOpacity: 1, sliceLeft: 24, sliceRight: 24, sliceTop: 24, sliceBottom: 24,
  mirrorH: false, mirrorV: false, hasBgImage: false,
  // bubbles theme — see backend/chatOverlayConfig.js
  allCaps: false, showBadges: true, showDecorations: true, ignoreCommands: "",
  fontSizeUsername: 24, fontWeightUsername: 400,
  fontSizeMessage: 20, fontWeightMessage: 400,
  fontSizeAlertUsername: 19, fontWeightAlertUsername: 400,
  usernameColor: "#F7FBFF", messageBackground: "#F7FBFF", messageBorder: "#EEB09E",
  messageColor: "#DB867A", alertColor: "#F7FBFF",
  flowerBorder: "#EEB09E", flowerFill: "#FCFEFF", flowerCenter: "#FBD5B5",
  flowerLeaf: "#92AF3E", flower2Leaf: "#92AF3E", flower2Fill: "#EEB09E",
  followAlertMessage: "just followed!",
  subAlertMessage: "just subscribed!",
  resubAlertMessage: "resubscribed for [amount] months!",
  giftedSubAlertMessage: "just gifted x[amount]!",
  cheerAlertMessage: "just cheered [amount] bits!",
  raidAlertMessage: "just raided with [amount]!",
  redeemAlertMessage: "redeemed [amount]!",
};

// Bubble-theme color pickers, in the order they appear in the panel. The
// flower group is only shown while the ornaments are enabled.
const BUBBLE_COLOR_KEYS = [
  "usernameColor", "messageBackground", "messageBorder", "messageColor", "alertColor",
];
const FLOWER_COLOR_KEYS = [
  "flowerBorder", "flowerFill", "flowerCenter", "flowerLeaf", "flower2Leaf", "flower2Fill",
];

const ALERT_COPY_KEYS = [
  "followAlertMessage", "subAlertMessage", "resubAlertMessage", "giftedSubAlertMessage",
  "cheerAlertMessage", "raidAlertMessage", "redeemAlertMessage",
];

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const COMMON_FONTS = [
  "Segoe UI", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia",
  "Times New Roman", "Courier New", "Comic Sans MS", "Impact", "Calibri",
];

const MAX_BG_BYTES = 5 * 1024 * 1024;
const ALLOWED_BG_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{ ...styles.toggle, background: checked ? "var(--purple)" : "var(--border)" }}
    >
      <span style={{ ...styles.toggleKnob, background: checked ? "var(--on-accent)" : "#fff", transform: checked ? "translateX(16px)" : "translateX(0)" }} />
    </button>
  );
}

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
export default function ChatOverlayPanel({ lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [overlayToken, setOverlayToken] = useState("");
  const [cfg, setCfg] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);

  // Local Font Access API (Chromium 103+, requires a user gesture + one-time
  // permission grant) — best-effort listing of fonts actually installed on
  // the streamer's machine. Falls back to a typeable field + common presets
  // when unsupported (Firefox/Safari, or permission denied).
  const [localFonts, setLocalFonts] = useState([]);
  const [fontLoadStatus, setFontLoadStatus] = useState(""); // "", "loading", "unsupported", "denied"

  // Background image upload/preview
  const [bgPreview, setBgPreview] = useState(null); // local data URL, once (re)uploaded this session
  const [bgUploading, setBgUploading] = useState(false);
  const [bgError, setBgError] = useState("");
  // Real pixel size of the uploaded image — slice insets are px of this, but
  // the preview thumbnail is scaled down, so guide lines need this to place
  // themselves at the correct % of the shrunk preview box.
  const [bgNaturalSize, setBgNaturalSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    apiFetch("/chat-overlay/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setOverlayUrl(data.url || "");
        try {
          setOverlayToken(data.url ? new URL(data.url).searchParams.get("token") || "" : "");
        } catch {
          setOverlayToken("");
        }
      })
      .catch(() => {});
    apiFetch("/chat-overlay/config")
      .then((res) => res.json())
      .then((data) => setCfg({ ...DEFAULTS, ...(data.config || {}) }))
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const loadLocalFonts = async () => {
    if (!window.queryLocalFonts) {
      setFontLoadStatus("unsupported");
      return;
    }
    setFontLoadStatus("loading");
    try {
      const fonts = await window.queryLocalFonts();
      const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
      setLocalFonts(families);
      setFontLoadStatus("");
    } catch {
      setFontLoadStatus("denied");
    }
  };

  const uploadBgImage = (file) => {
    if (!file) return;
    setBgError("");
    if (!ALLOWED_BG_TYPES.includes(file.type)) {
      setBgError(t("chatOverlayPanel.bgBadFormat"));
      return;
    }
    if (file.size > MAX_BG_BYTES) {
      setBgError(t("chatOverlayPanel.bgTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setBgPreview(dataUrl);
      setBgUploading(true);
      try {
        const res = await apiFetch("/chat-overlay/bg-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setCfg((prev) => ({ ...prev, hasBgImage: true }));
      } catch (err) {
        setBgError(t("chatOverlayPanel.bgUploadError", { error: err.message }));
      } finally {
        setBgUploading(false);
      }
    };
    reader.onerror = () => setBgError(t("chatOverlayPanel.bgReadError", { file: file.name }));
    reader.readAsDataURL(file);
  };

  const removeBgImage = async () => {
    setBgUploading(true);
    try {
      await apiFetch("/chat-overlay/bg-image", { method: "DELETE" });
      setBgPreview(null);
      setCfg((prev) => ({ ...prev, hasBgImage: false }));
    } catch {
      // Best-effort — the panel already reflects nothing changed.
    } finally {
      setBgUploading(false);
    }
  };

  const bgImageSrc = bgPreview || (cfg.hasBgImage && overlayToken
    ? apiUrl(`/chat-overlay/bg-image?token=${overlayToken}`)
    : null);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy from Settings instead.
    }
  };

  // Optimistic local update + debounced save — the overlay picks up the
  // change live over its WS connection once the POST lands (see
  // backend/index.js POST /chat-overlay/config and backend/overlay/chat.html).
  const set = useCallback((key, value) => {
    setCfg((prev) => {
      const next = { ...prev, [key]: value };
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        apiFetch("/chat-overlay/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      }, 300);
      return next;
    });
  }, []);

  // Fake data, broadcast only to this account's overlay(s) over the /chat
  // WS under dedicated types the main app ignores — see the
  // /chat-overlay/test-* routes in backend/index.js. Lets the streamer
  // preview fonts/colors/banner/nine-slice without waiting for real chat.
  const sendTest = async (kind) => {
    try {
      await apiFetch(`/chat-overlay/test-${kind}`, { method: "POST" });
    } catch {
      // Best-effort preview helper — nothing to show the user on failure.
    }
  };

  return (
    <>
      <div style={styles.body}>
        <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl} title={t("chatOverlayPanel.copyOverlayTitle")}>
          {overlayCopied ? t("chatOverlayPanel.copied") : t("chatOverlayPanel.copyOverlay")}
        </button>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.testSection")}</div>
        <div style={styles.row2}>
          <button type="button" style={styles.actionBtn} onClick={() => sendTest("message")}>
            {t("chatOverlayPanel.testMessage")}
          </button>
          <button type="button" style={styles.actionBtn} onClick={() => sendTest("redeem")}>
            {t("chatOverlayPanel.testRedeem")}
          </button>
        </div>
        <button type="button" style={styles.actionBtn} onClick={() => sendTest("event")}>
          {t("chatOverlayPanel.testEvent")}
        </button>
        <span style={styles.fieldLabel}>{t("chatOverlayPanel.testHint")}</span>

        <div style={styles.divider} />

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.theme")}</label>
          <select value={cfg.theme} onChange={(e) => set("theme", e.target.value)} disabled={!loaded}>
            <option value="default">{t("chatOverlayPanel.themeDefault")}</option>
            <option value="bubbles">{t("chatOverlayPanel.themeBubbles")}</option>
          </select>
          <span style={styles.fieldLabel}>{t("chatOverlayPanel.themeSwitchHint")}</span>
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.feedSection")}</div>

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.maxMessages")}</label>
          <input type="number" min={1} max={200} value={cfg.max} onChange={(e) => set("max", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.fade")}</label>
          <input type="number" min={0} max={600} value={cfg.fade} onChange={(e) => set("fade", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showEvents")}</span>
          <Toggle checked={cfg.showEvents} onChange={() => set("showEvents", !cfg.showEvents)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showRedeems")}</span>
          <Toggle checked={cfg.showRedeems} onChange={() => set("showRedeems", !cfg.showRedeems)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showBotMessages")}</span>
          <Toggle checked={cfg.showBotMessages} onChange={() => set("showBotMessages", !cfg.showBotMessages)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showBanner")}</span>
          <Toggle checked={cfg.showBanner} onChange={() => set("showBanner", !cfg.showBanner)} />
        </div>
        {cfg.showBanner && (
          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t("chatOverlayPanel.bannerDuration")}</label>
            <input type="number" min={1000} max={30000} step={500} value={cfg.bannerDuration} onChange={(e) => set("bannerDuration", Number(e.target.value))} disabled={!loaded} />
          </div>
        )}
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.direction")}</label>
          <select value={cfg.direction} onChange={(e) => set("direction", e.target.value)} disabled={!loaded}>
            <option value="up">{t("chatOverlayPanel.directionUp")}</option>
            <option value="down">{t("chatOverlayPanel.directionDown")}</option>
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.align")}</label>
          <select value={cfg.align} onChange={(e) => set("align", e.target.value)} disabled={!loaded}>
            <option value="left">{t("chatOverlayPanel.alignLeft")}</option>
            <option value="right">{t("chatOverlayPanel.alignRight")}</option>
          </select>
        </div>
        {cfg.theme === "default" && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>{t("chatOverlayPanel.timestamps")}</span>
            <Toggle checked={cfg.timestamps} onChange={() => set("timestamps", !cfg.timestamps)} />
          </div>
        )}
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.userColor")}</span>
          <Toggle checked={cfg.userColor} onChange={() => set("userColor", !cfg.userColor)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.animate")}</span>
          <Toggle checked={cfg.animate} onChange={() => set("animate", !cfg.animate)} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.eventLang")}</label>
          <select value={cfg.lang} onChange={(e) => set("lang", e.target.value)} disabled={!loaded}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.appearanceSection")}</div>

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.width")}</label>
          <input type="number" min={200} max={1200} value={cfg.width} onChange={(e) => set("width", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.maxHeight")}</label>
          <input type="number" min={100} max={3000} value={cfg.maxHeight} onChange={(e) => set("maxHeight", Number(e.target.value))} disabled={!loaded} />
        </div>
        {cfg.theme === "default" && (
          <>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("chatOverlayPanel.fontSize")}</label>
              <input type="number" min={8} max={64} value={cfg.fontsize} onChange={(e) => set("fontsize", Number(e.target.value))} disabled={!loaded} />
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("chatOverlayPanel.bgOpacity", { pct: Math.round(cfg.bg * 100) })}</label>
              <input type="range" min={0} max={1} step={0.05} value={cfg.bg} onChange={(e) => set("bg", Number(e.target.value))} disabled={!loaded || cfg.hasBgImage} />
              {cfg.hasBgImage && <span style={styles.fieldLabel}>{t("chatOverlayPanel.bgOpacityDisabled")}</span>}
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("chatOverlayPanel.textColor")}</label>
              <input type="color" value={"#" + cfg.textcolor} onChange={(e) => set("textcolor", e.target.value.replace(/^#/, ""))} disabled={!loaded} style={styles.colorInput} />
            </div>
          </>
        )}

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.fontFamily")}</label>
          <input
            list="chatOverlayFontList"
            value={cfg.fontFamily}
            placeholder={t("chatOverlayPanel.fontFamilyPlaceholder")}
            onChange={(e) => set("fontFamily", e.target.value)}
            disabled={!loaded}
          />
          <datalist id="chatOverlayFontList">
            {(localFonts.length ? localFonts : COMMON_FONTS).map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <button
            type="button"
            style={{ ...styles.actionBtn, marginTop: 4 }}
            onClick={loadLocalFonts}
            disabled={fontLoadStatus === "loading"}
          >
            {fontLoadStatus === "loading" ? t("chatOverlayPanel.fontLoading") : t("chatOverlayPanel.fontLoadButton")}
          </button>
          {fontLoadStatus === "unsupported" && (
            <span style={styles.avatarErrorText}>{t("chatOverlayPanel.fontUnsupported")}</span>
          )}
          {fontLoadStatus === "denied" && (
            <span style={styles.avatarErrorText}>{t("chatOverlayPanel.fontDenied")}</span>
          )}
        </div>

        {cfg.theme === "bubbles" && (
          <>
            <div style={styles.divider} />
            <div style={styles.sectionLabel}>{t("chatOverlayPanel.bubbleSection")}</div>
            <span style={styles.fieldLabel}>{t("chatOverlayPanel.bubbleHint")}</span>

            <div style={styles.row}>
              <span style={styles.rowLabel}>{t("chatOverlayPanel.showBadges")}</span>
              <Toggle checked={cfg.showBadges} onChange={() => set("showBadges", !cfg.showBadges)} />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>{t("chatOverlayPanel.showDecorations")}</span>
              <Toggle checked={cfg.showDecorations} onChange={() => set("showDecorations", !cfg.showDecorations)} />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>{t("chatOverlayPanel.allCaps")}</span>
              <Toggle checked={cfg.allCaps} onChange={() => set("allCaps", !cfg.allCaps)} />
            </div>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("chatOverlayPanel.ignoreCommands")}</label>
              <input value={cfg.ignoreCommands} onChange={(e) => set("ignoreCommands", e.target.value)} disabled={!loaded} />
            </div>

            <div style={styles.row2}>
              {[
                ["fontSizeUsername", "fontWeightUsername"],
                ["fontSizeMessage", "fontWeightMessage"],
                ["fontSizeAlertUsername", "fontWeightAlertUsername"],
              ].map(([sizeKey, weightKey]) => (
                <React.Fragment key={sizeKey}>
                  <div style={styles.field}>
                    <label style={styles.fieldLabel}>{t(`chatOverlayPanel.${sizeKey}`)}</label>
                    <input type="number" min={8} max={96} value={cfg[sizeKey]} onChange={(e) => set(sizeKey, Number(e.target.value))} disabled={!loaded} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.fieldLabel}>{t(`chatOverlayPanel.${weightKey}`)}</label>
                    <select value={cfg[weightKey]} onChange={(e) => set(weightKey, Number(e.target.value))} disabled={!loaded}>
                      {FONT_WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                </React.Fragment>
              ))}
            </div>

            <div style={styles.sectionLabel}>{t("chatOverlayPanel.bubbleColors")}</div>
            <div style={styles.row2}>
              {[...BUBBLE_COLOR_KEYS, ...(cfg.showDecorations ? FLOWER_COLOR_KEYS : [])].map((key) => (
                <div key={key} style={styles.field}>
                  <label style={styles.fieldLabel}>{t(`chatOverlayPanel.${key}`)}</label>
                  <input type="color" value={cfg[key]} onChange={(e) => set(key, e.target.value)} disabled={!loaded} style={styles.colorInput} />
                </div>
              ))}
            </div>

            <div style={styles.divider} />
            <div style={styles.sectionLabel}>{t("chatOverlayPanel.alertCopySection")}</div>
            <span style={styles.fieldLabel}>{t("chatOverlayPanel.alertCopyHint")}</span>
            {ALERT_COPY_KEYS.map((key) => (
              <div key={key} style={styles.field}>
                <label style={styles.fieldLabel}>{t(`chatOverlayPanel.${key}`)}</label>
                <input value={cfg[key]} onChange={(e) => set(key, e.target.value)} disabled={!loaded} />
              </div>
            ))}
          </>
        )}

        {/* The nine-slice background image is a feature of the classic row
            renderer only — the bubble theme draws its own bubble art. */}
        {cfg.theme === "default" && (
        <>
        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.bgImageSection")}</div>

        {bgImageSrc && (
          <div style={styles.bgPreviewWrap}>
            <div style={styles.bgPreviewFrame}>
              <img
                src={bgImageSrc}
                alt=""
                style={styles.bgPreviewImg}
                onLoad={(e) => setBgNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
              />
              {bgNaturalSize.width > 0 && (
                <>
                  <div style={{ ...styles.sliceLineV, left: `${Math.min(100, (cfg.sliceLeft / bgNaturalSize.width) * 100)}%` }} />
                  <div style={{ ...styles.sliceLineV, right: `${Math.min(100, ((cfg.mirrorH ? cfg.sliceLeft : cfg.sliceRight) / bgNaturalSize.width) * 100)}%` }} />
                  <div style={{ ...styles.sliceLineH, top: `${Math.min(100, (cfg.sliceTop / bgNaturalSize.height) * 100)}%` }} />
                  <div style={{ ...styles.sliceLineH, bottom: `${Math.min(100, ((cfg.mirrorV ? cfg.sliceTop : cfg.sliceBottom) / bgNaturalSize.height) * 100)}%` }} />
                </>
              )}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ ...styles.uploadLabel, flex: 1, cursor: bgUploading ? "default" : "pointer", opacity: bgUploading ? 0.6 : 1 }}>
            {bgUploading ? t("chatOverlayPanel.bgUploading") : t("chatOverlayPanel.bgUpload")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              disabled={bgUploading}
              onChange={(e) => {
                uploadBgImage(e.target.files[0]);
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>
          {cfg.hasBgImage && (
            <button type="button" style={styles.actionBtn} onClick={removeBgImage} disabled={bgUploading}>
              {t("chatOverlayPanel.bgRemove")}
            </button>
          )}
        </div>
        {bgError && <span style={styles.avatarErrorText}>{bgError}</span>}

        {cfg.hasBgImage && (
          <>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("chatOverlayPanel.bgImageOpacity", { pct: Math.round(cfg.bgImageOpacity * 100) })}</label>
              <input type="range" min={0} max={1} step={0.05} value={cfg.bgImageOpacity} onChange={(e) => set("bgImageOpacity", Number(e.target.value))} disabled={!loaded} />
            </div>

            <div style={styles.fieldLabel}>{t("chatOverlayPanel.sliceHint")}</div>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("chatOverlayPanel.sliceLeft")}</label>
                <input type="number" min={0} max={500} value={cfg.sliceLeft} onChange={(e) => set("sliceLeft", Number(e.target.value))} disabled={!loaded} />
              </div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("chatOverlayPanel.sliceRight")}</label>
                <input type="number" min={0} max={500} value={cfg.sliceRight} onChange={(e) => set("sliceRight", Number(e.target.value))} disabled={!loaded || cfg.mirrorH} />
              </div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("chatOverlayPanel.sliceTop")}</label>
                <input type="number" min={0} max={500} value={cfg.sliceTop} onChange={(e) => set("sliceTop", Number(e.target.value))} disabled={!loaded} />
              </div>
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("chatOverlayPanel.sliceBottom")}</label>
                <input type="number" min={0} max={500} value={cfg.sliceBottom} onChange={(e) => set("sliceBottom", Number(e.target.value))} disabled={!loaded || cfg.mirrorV} />
              </div>
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>{t("chatOverlayPanel.mirrorH")}</span>
              <Toggle checked={cfg.mirrorH} onChange={() => set("mirrorH", !cfg.mirrorH)} />
            </div>
            <div style={styles.row}>
              <span style={styles.rowLabel}>{t("chatOverlayPanel.mirrorV")}</span>
              <Toggle checked={cfg.mirrorV} onChange={() => set("mirrorV", !cfg.mirrorV)} />
            </div>
          </>
        )}
        </>
        )}
      </div>
      <div style={styles.hint}>{t("chatOverlayPanel.hint")}</div>
    </>
  );
}

const styles = {
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "14px 12px",
    overflowY: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowLabel: {
    fontSize: 12,
    color: "var(--text)",
  },
  toggle: {
    width: 34,
    height: 18,
    borderRadius: 9,
    padding: 2,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.15s",
  },
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "2px 0",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  colorInput: {
    width: "100%",
    height: 28,
    padding: 2,
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  bgPreviewWrap: {
    display: "flex",
    justifyContent: "center",
  },
  bgPreviewFrame: {
    position: "relative",
    display: "inline-block",
    lineHeight: 0,
  },
  bgPreviewImg: {
    maxWidth: "100%",
    maxHeight: 140,
    display: "block",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface2)",
  },
  sliceLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 0,
    borderLeft: "1px dashed #00e5ff",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
    pointerEvents: "none",
  },
  sliceLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    borderTop: "1px dashed #00e5ff",
    boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
    pointerEvents: "none",
  },
  uploadLabel: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    padding: "6px 4px",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center",
  },
  avatarErrorText: {
    fontSize: 10,
    color: "var(--red)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
