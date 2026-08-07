import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Twitch box art comes back as a template URL with a {width}x{height}
// placeholder — substitute a small thumbnail size for the search dropdown.
function boxArtThumb(url) {
  return url ? url.replace("{width}x{height}", "40x53") : "";
}

export default function StreamSettingsPanel({ lang }) {
  const { t } = useTranslation(lang);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("streamSettingsPanelCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("streamSettingsPanelCollapsed", next ? "1" : "0");
      } catch {
        // localStorage unavailable — collapse choice won't persist.
      }
      return next;
    });
  };

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
    if (!collapsed) loadInfo();
    return () => {
      clearTimeout(searchTimerRef.current);
    };
  }, [collapsed, loadInfo]);

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

  if (collapsed) {
    return (
      <div style={styles.collapsedPanel}>
        <button style={styles.collapseBtn} onClick={toggleCollapsed} title={t("streamSettingsPanel.expand")}>
          ⟨
        </button>
        <span style={styles.verticalTitle}>{t("streamSettingsPanel.title")}</span>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>{t("streamSettingsPanel.title")}</span>
        <button style={styles.collapseBtn} onClick={toggleCollapsed} title={t("streamSettingsPanel.collapse")}>
          ⟩
        </button>
      </div>

      {scopeError ? (
        <div style={styles.body}>
          <div style={styles.scopeErrorBox}>
            <div style={styles.scopeErrorTitle}>{t("streamSettingsPanel.scopeErrorTitle")}</div>
            <div style={styles.fieldLabel}>{t("streamSettingsPanel.scopeErrorBody")}</div>
            <button type="button" style={styles.actionBtn} onClick={logout}>
              {t("streamSettingsPanel.logout")}
            </button>
          </div>
        </div>
      ) : (
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
            {saveStatus === "saving" ? t("streamSettingsPanel.saving") : t("streamSettingsPanel.save")}
          </button>
          {saveStatus === "saved" && <span style={styles.fieldLabel}>{t("streamSettingsPanel.saved")}</span>}
          {saveStatus === "error" && (
            <span style={styles.errorText}>{t("streamSettingsPanel.saveError", { error: saveErrorMsg })}</span>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  panel: {
    width: 240,
    minWidth: 200,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    overflow: "hidden",
    flexShrink: 0,
  },
  collapsedPanel: {
    width: 28,
    minWidth: 28,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
    paddingTop: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
  },
  collapseBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "3px 7px",
  },
  verticalTitle: {
    writingMode: "vertical-rl",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
    whiteSpace: "nowrap",
    marginTop: 10,
  },
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
