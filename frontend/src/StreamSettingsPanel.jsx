import React, { useState, useEffect, useRef, useCallback } from "react";
import { Save, Check } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Twitch box art comes back as a template URL with a {width}x{height}
// placeholder — substitute a small thumbnail size for the search dropdown.
function boxArtThumb(url) {
  return url ? url.replace("{width}x{height}", "40x53") : "";
}

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
export default function StreamSettingsPanel({ lang }) {
  const { t } = useTranslation(lang);

  const [loaded, setLoaded] = useState(false);
  const [scopeError, setScopeError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [title, setTitle] = useState("");
  const [initialTitle, setInitialTitle] = useState("");
  const [category, setCategory] = useState(null); // { id, name, boxArtUrl } | null
  const [initialCategoryId, setInitialCategoryId] = useState(null);

  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryResults, setCategoryResults] = useState([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef(null);
  const searchSeq = useRef(0);

  const [saveStatus, setSaveStatus] = useState(""); // "", "saving", "saved", "error"
  const [saveErrorMsg, setSaveErrorMsg] = useState("");

  const loadInfo = useCallback(() => {
    setLoadError(false);
    apiFetch("/stream/info")
      .then(async (res) => {
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data.error === "MISSING_SCOPE") return setScopeError(true);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setTitle(data.title || "");
        setInitialTitle(data.title || "");
        const initial = data.gameId ? { id: data.gameId, name: data.gameName, boxArtUrl: "" } : null;
        setCategory(initial);
        setInitialCategoryId(data.gameId || null);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    loadInfo();
    return () => {
      clearTimeout(searchTimerRef.current);
    };
  }, [loadInfo]);

  // Debounced, out-of-order-safe category search as the user types.
  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    const query = categoryQuery.trim();
    if (!query) {
      setCategoryResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const seq = ++searchSeq.current;
      try {
        const res = await apiFetch(`/stream/categories?query=${encodeURIComponent(query)}`);
        const data = await res.json().catch(() => ({}));
        if (seq !== searchSeq.current) return; // a newer search superseded this one
        if (res.status === 403 && data.error === "MISSING_SCOPE") {
          setScopeError(true);
          return;
        }
        setCategoryResults(data.categories || []);
      } catch {
        if (seq === searchSeq.current) setCategoryResults([]);
      }
    }, 300);
  }, [categoryQuery]);

  const pickCategory = (cat) => {
    setCategory(cat);
    setCategoryQuery("");
    setCategoryResults([]);
    setSearchOpen(false);
  };

  const save = async () => {
    setSaveStatus("saving");
    const body = {};
    if (title !== initialTitle) body.title = title;
    if (category?.id !== initialCategoryId) body.gameId = category?.id || "";
    if (Object.keys(body).length === 0) {
      setSaveStatus("");
      return;
    }
    try {
      const res = await apiFetch("/stream/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403 && data.error === "MISSING_SCOPE") {
        setScopeError(true);
        setSaveStatus("");
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInitialTitle(title);
      setInitialCategoryId(category?.id || null);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 1500);
    } catch (err) {
      setSaveStatus("error");
      setSaveErrorMsg(err.message);
    }
  };

  const dirty = title !== initialTitle || (category?.id || null) !== initialCategoryId;
  const logout = () => apiFetch("/auth/logout", { method: "POST" }).finally(() => window.location.reload());

  if (scopeError) {
    return (
      <div style={styles.body}>
        <div style={styles.scopeErrorBox}>
          <div style={styles.scopeErrorTitle}>{t("streamSettingsPanel.scopeErrorTitle")}</div>
          <div style={styles.fieldLabel}>{t("streamSettingsPanel.scopeErrorBody")}</div>
          <button type="button" style={styles.actionBtn} onClick={logout}>
            {t("streamSettingsPanel.logout")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.body}>
      {loadError && <span style={styles.errorText}>{t("streamSettingsPanel.loadError")}</span>}

      <div style={styles.field}>
        <label style={styles.fieldLabel}>{t("streamSettingsPanel.titleLabel")}</label>
        <input
          type="text"
          value={title}
          placeholder={t("streamSettingsPanel.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          disabled={!loaded}
          maxLength={140}
        />
      </div>

      <div style={{ ...styles.field, position: "relative" }}>
        <label style={styles.fieldLabel}>{t("streamSettingsPanel.categoryLabel")}</label>
        {category && !searchOpen ? (
          <button type="button" style={styles.categoryChip} onClick={() => setSearchOpen(true)} disabled={!loaded}>
            {category.boxArtUrl && <img src={boxArtThumb(category.boxArtUrl)} alt="" style={styles.categoryChipImg} />}
            <span>{category.name}</span>
          </button>
        ) : (
          <input
            type="text"
            value={categoryQuery}
            placeholder={t("streamSettingsPanel.categorySearchPlaceholder")}
            onChange={(e) => setCategoryQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            disabled={!loaded}
          />
        )}
        {searchOpen && categoryQuery.trim() && (
          <div style={styles.dropdown}>
            {categoryResults.length === 0 ? (
              <div style={styles.dropdownEmpty}>{t("streamSettingsPanel.noResults")}</div>
            ) : (
              categoryResults.map((c) => (
                <button key={c.id} type="button" style={styles.dropdownRow} onClick={() => pickCategory(c)}>
                  <img src={boxArtThumb(c.boxArtUrl)} alt="" style={styles.dropdownImg} />
                  <span>{c.name}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <button type="button" style={styles.actionBtn} onClick={save} disabled={!loaded || !dirty || saveStatus === "saving"}>
        {saveStatus !== "saving" && <Save size={14} color="var(--accent)" />}{" "}
        {saveStatus === "saving" ? t("streamSettingsPanel.saving") : t("streamSettingsPanel.save")}
      </button>
      {saveStatus === "saved" && (
        <span style={styles.fieldLabel}>
          <Check size={14} color="var(--green)" /> {t("streamSettingsPanel.saved")}
        </span>
      )}
      {saveStatus === "error" && (
        <span style={styles.errorText}>{t("streamSettingsPanel.saveError", { error: saveErrorMsg })}</span>
      )}
    </div>
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
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  errorText: {
    fontSize: 11,
    color: "var(--red)",
  },
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  categoryChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  categoryChipImg: {
    width: 20,
    height: 27,
    objectFit: "cover",
    borderRadius: 2,
    flexShrink: 0,
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    zIndex: 10,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    maxHeight: 240,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
  },
  dropdownRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "transparent",
    border: "none",
    borderBottom: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    textAlign: "left",
  },
  dropdownImg: {
    width: 20,
    height: 27,
    objectFit: "cover",
    borderRadius: 2,
    flexShrink: 0,
  },
  dropdownEmpty: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "8px",
  },
  scopeErrorBox: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  scopeErrorTitle: {
    fontWeight: 700,
    fontSize: 12,
    color: "var(--text)",
  },
};
