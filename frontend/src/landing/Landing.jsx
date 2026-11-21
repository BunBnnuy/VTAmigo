import React, { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Pause, Play, X } from "lucide-react";
import { apiUrl } from "../api.js";
import { detectLanguage, SUPPORTED_LANGUAGES, useTranslation } from "../i18n/index.js";
import { DEMO_CONTENT } from "./demoScripts.js";
import logo from "../img/logo-cartoon.webp";
import mascot from "../img/mascot.webp";
import "./landing.css";

const LANDING_LANG_KEY = "landingLang";
const EVENT_TYPES = ["follow", "sub", "raid", "bits"];
const FAQ_KEYS = ["what", "need", "approval", "data"];
const FEATURE_KEYS = ["chat", "tts", "overlay", "events", "voice", "leveling"];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduced(event.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

// Adds the `.is-js` / `.is-in` pair that drives the landing's scroll reveal.
// The class is only added after mount so a JS failure leaves everything
// visible instead of a blank page, and the observer is rooted at the scroll
// container (not the viewport) because `#root` owns the scroll here.
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    root.classList.add("is-js");
    const items = root.querySelectorAll(".reveal");
    if (typeof IntersectionObserver === "undefined") {
      items.forEach((item) => item.classList.add("is-in"));
      return () => root.classList.remove("is-js");
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px", root }
    );
    items.forEach((item) => observer.observe(item));
    return () => {
      observer.disconnect();
      root.classList.remove("is-js");
    };
  }, [rootRef]);
}

function DemoPanel({ t, content }) {
  const shellRef = useRef(null);
  const feedIdRef = useRef(0);
  const stepRef = useRef(2);
  const speakTimerRef = useRef(null);
  const eventTimerRef = useRef(null);
  const captionBoxRef = useRef(null);

  const [feed, setFeed] = useState(() =>
    content.messages.slice(0, 2).map((message) => ({ ...message, id: feedIdRef.current++, kind: "message" }))
  );
  const [caption, setCaption] = useState(content.initialCaption);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => !document.hidden);
  const [event, setEvent] = useState(null);
  const reducedMotion = usePrefersReducedMotion();

  const speak = useCallback(() => {
    setSpeaking(true);
    clearTimeout(speakTimerRef.current);
    speakTimerRef.current = setTimeout(() => setSpeaking(false), 2800);
  }, []);

  const say = useCallback(
    (line, announce) => {
      setCaption(line);
      if (announce && captionBoxRef.current) {
        const box = captionBoxRef.current;
        box.setAttribute("aria-live", "polite");
        clearTimeout(box._liveTimer);
        box._liveTimer = setTimeout(() => box.setAttribute("aria-live", "off"), 2600);
      }
      speak();
    },
    [speak]
  );

  const pushMessage = useCallback((message) => {
    setFeed((prev) => [...prev, { ...message, id: feedIdRef.current++, kind: "message" }].slice(-4));
  }, []);

  const triggerEvent = (type) => {
    const data = content.events[type];
    if (!data) return;
    setEvent({ ...data, type });
    setFeed((prev) =>
      [...prev, { id: feedIdRef.current++, kind: "system", tag: data.tag, color: data.color, text: data.text }].slice(-4)
    );
    say(data.line, true);
    clearTimeout(eventTimerRef.current);
    eventTimerRef.current = setTimeout(() => setEvent(null), 4200);
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    if (next) {
      clearTimeout(speakTimerRef.current);
      clearTimeout(eventTimerRef.current);
      setSpeaking(false);
      setEvent(null);
    }
  };

  // Autoplay advances the scripted chat while the demo is on screen, the tab
  // is visible, and the visitor has not paused it. Reduced-motion visitors get
  // the static opening instead of a stream of moving messages.
  useEffect(() => {
    if (paused || !visible || !tabVisible || reducedMotion) return undefined;
    let cancelled = false;
    let timer = null;
    let replyTimer = null;

    const schedule = (delay) => {
      timer = setTimeout(() => {
        if (cancelled) return;
        const index = stepRef.current % content.messages.length;
        pushMessage(content.messages[index]);
        if (index % 2 === 0) {
          clearTimeout(replyTimer);
          replyTimer = setTimeout(() => {
            if (!cancelled) say(content.replies[index], false);
          }, 640);
        }
        stepRef.current += 1;
        schedule(3400);
      }, delay);
    };

    schedule(1800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(replyTimer);
    };
  }, [paused, visible, tabVisible, reducedMotion, content, pushMessage, say]);

  useEffect(() => {
    const element = shellRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => setVisible(entry.isIntersecting)),
      { threshold: 0.15 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(
    () => () => {
      clearTimeout(speakTimerRef.current);
      clearTimeout(eventTimerRef.current);
    },
    []
  );

  const levelLabel = t("login.demo.level", { level: 12 });
  const xpLabel = t("login.demo.xp", { current: 680, max: 1000 });

  return (
    <aside
      ref={shellRef}
      className="demo-shell reveal scroll-anchor"
      id="demo"
      aria-label={t("login.demo.source")}
    >
      <div className="demo-top">
        <span className="demo-title">{t("login.demo.source")}</span>
        <span className="demo-live">
          <span className="dot" aria-hidden="true" />
          {t("login.demo.live")}
        </span>
      </div>

      <div className="demo-stage">
        <div className="stage-chat">
          <div className="stage-chat-head">
            <span>{t("login.demo.chat")}</span>
            <span className="pixel-dot" aria-hidden="true" />
          </div>
          <div className="chat-feed" role="log" aria-live="off" aria-label={t("login.demo.chat")}>
            {feed.map((item) =>
              item.kind === "system" ? (
                <div className="msg-system" key={item.id}>
                  <span className="sys-tag" style={{ color: item.color }}>
                    {item.tag}
                  </span>
                  <span className="od-truncate">{item.text}</span>
                </div>
              ) : (
                <div className="msg" key={item.id}>
                  <span className="msg-user" style={{ color: item.color }}>
                    {item.user}
                  </span>
                  <span className="msg-text">{item.text}</span>
                </div>
              )
            )}
          </div>
        </div>

        <div className="stage-avatar">
          <div className={`avatar-frame${speaking ? " is-speaking" : ""}`}>
            <img src={mascot} alt="" width={440} height={762} />
          </div>
          <div className="avatar-name">
            <span>VTAmigo</span>
            <span className="avatar-tag">{t("login.demo.aiTag")}</span>
            <span className="speak-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>

        <div className="stage-caption" ref={captionBoxRef}>
          <span className="caption-label">{t("login.demo.says")}</span>
          <p className="caption-text">{caption}</p>
        </div>

        <div className="stage-xp">
          <div className="xp-head">
            <span>{levelLabel}</span>
            <span>{xpLabel}</span>
          </div>
          <div className="xp-track" role="img" aria-label={`${levelLabel} · ${xpLabel}`}>
            <div className="xp-fill" />
          </div>
        </div>

        {event && (
          <div className="stage-event" data-type={event.type}>
            <span className="event-tag" style={{ color: event.color }}>
              {event.tag}
            </span>
            <span className="event-name">{event.user}</span>
          </div>
        )}
      </div>

      <div className="demo-controls">
        <div className="event-buttons" role="group" aria-label={t("login.demo.tryReaction")}>
          <span className="controls-label">{t("login.demo.tryReaction")}</span>
          {EVENT_TYPES.map((type) => (
            <button className="evt-btn" type="button" data-event={type} key={type} onClick={() => triggerEvent(type)}>
              {t(`login.demo.${type}`)}
            </button>
          ))}
        </div>
        <button className="demo-pause" type="button" aria-pressed={paused} onClick={togglePause}>
          {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          <span>{paused ? t("login.demo.resume") : t("login.demo.pause")}</span>
        </button>
      </div>
      <p className="demo-note">{t("login.demo.note")}</p>
    </aside>
  );
}

export default function Landing() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANDING_LANG_KEY) || detectLanguage());
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const rootRef = useRef(null);
  const { t, lang: uiLang } = useTranslation(lang);
  useReveal(rootRef);

  const loginHref = apiUrl("/auth/twitch/login");
  const demoContent = DEMO_CONTENT[uiLang] || DEMO_CONTENT.en;

  useEffect(() => {
    localStorage.setItem(LANDING_LANG_KEY, lang);
    document.documentElement.lang = uiLang;
  }, [lang, uiLang]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const onScroll = () => setScrolled(root.scrollTop > 8);
    root.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth > 960) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const navLinks = [
    { href: "#como-funciona", label: t("login.nav.how") },
    { href: "#funciones", label: t("login.nav.features") },
    { href: "#demo", label: t("login.nav.demo") },
    { href: "#faq", label: t("login.nav.faq") },
  ];

  return (
    <div className="landing" ref={rootRef}>
      <a className="skip-link" href="#main">
        {t("login.skip")}
      </a>

      <header className={`site-header${scrolled ? " is-scrolled" : ""}`} id="inicio">
        <div className="container header-inner">
          <a className="brand" href="#inicio">
            <span className="brand-mark">
              <img src={logo} alt="" width={128} height={128} />
            </span>
            <span className="brand-name">
              VT<span className="brand-accent">Amigo</span>
            </span>
          </a>

          <nav className="desktop-nav" aria-label={t("login.mainNav")}>
            {navLinks.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="header-actions">
            <select
              className="lang-select"
              value={uiLang}
              onChange={(event) => setLang(event.target.value)}
              aria-label={t("login.langLabel")}
            >
              {SUPPORTED_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
            <a className="header-login" href={loginHref}>
              {t("login.logIn")}
            </a>
            <button
              className="nav-toggle"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? t("login.closeMenu") : t("login.openMenu")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="mobile-nav" id="mobile-nav" hidden={!menuOpen}>
          {navLinks.map((link) => (
            <a key={link.href} href={link.href} onClick={closeMenu}>
              {link.label}
            </a>
          ))}
          <a className="header-login" href={loginHref} onClick={closeMenu}>
            {t("login.logIn")}
          </a>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy reveal">
              <h1>{t("login.title")}</h1>
              <p className="hero-sub">{t("login.subtitle")}</p>
              <div className="hero-actions">
                <a className="btn btn-primary" href={loginHref}>
                  {t("login.heroCta")}
                </a>
                <a className="hero-quiet" href="#como-funciona">
                  {t("login.heroQuiet")}
                </a>
              </div>
              <p className="hero-note">{t("login.ctaNote")}</p>
            </div>

            <DemoPanel key={uiLang} t={t} content={demoContent} />
          </div>
        </section>

        <section className="section scroll-anchor" id="como-funciona">
          <div className="container">
            <h2 className="reveal">{t("login.stepsTitle")}</h2>
            <ul className="steps">
              {["connect", "tone", "overlays"].map((key) => (
                <li className="step reveal" key={key}>
                  <h3>{t(`login.steps.${key}.title`)}</h3>
                  <p>{t(`login.steps.${key}.desc`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="section scroll-anchor" id="funciones">
          <div className="container">
            <h2 className="reveal">{t("login.featuresTitle")}</h2>
            <ul className="feature-list">
              {FEATURE_KEYS.map((key) => (
                <li className="reveal" key={key}>
                  <h3>{t(`login.features.${key}.title`)}</h3>
                  <p>{t(`login.features.${key}.desc`)}</p>
                </li>
              ))}
            </ul>

            <div className="personality reveal">
              <div className="personality-copy">
                <h3>{t("login.personality.title")}</h3>
                <p>{t("login.personality.desc")}</p>
              </div>
              <div className="prompt-mock" role="img" aria-label={t("login.personality.promptLabel")}>
                <div className="prompt-head">
                  <span>{t("login.personality.promptLabel")}</span>
                </div>
                <div className="prompt-body">
                  {t("login.personality.promptLine1")}
                  <br />
                  {t("login.personality.promptLine2")}
                  <br />
                  {t("login.personality.promptLine3")}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="overlays">
          <div className="container overlay-grid">
            <div className="reveal">
              <h2>{t("login.scene.title")}</h2>
              <ul className="overlay-points">
                {["avatar", "xp", "ranking"].map((key) => (
                  <li key={key}>
                    <h3>{t(`login.scene.${key}.title`)}</h3>
                    <p>{t(`login.scene.${key}.desc`)}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="obs-mock reveal" role="img" aria-label={t("login.scene.mockLabel")}>
              <div className="obs-head">
                <span>{t("login.scene.mockLabel")}</span>
              </div>
              <div className="overlay-card">
                <div className="oc-label">
                  <span>{t("login.scene.mockXp")}</span>
                  <span>{t("login.demo.level", { level: 12 })}</span>
                </div>
                <div className="oc-xp-row">
                  <span className="oc-level">{t("login.demo.level", { level: 12 })}</span>
                  <span className="oc-value">{t("login.demo.xp", { current: 680, max: 1000 })}</span>
                </div>
                <div className="oc-track">
                  <div className="oc-fill" />
                </div>
              </div>
              <div className="overlay-card">
                <div className="oc-label">
                  <span>{t("login.scene.mockRanking")}</span>
                  <span>{t("login.scene.mockWeek")}</span>
                </div>
                <div className="rank-row">
                  <span className="rank-pos">1</span>
                  <span className="rank-name">pixelpanda</span>
                  <span className="rank-xp">2 480 XP</span>
                </div>
                <div className="rank-row">
                  <span className="rank-pos">2</span>
                  <span className="rank-name">nova_ttv</span>
                  <span className="rank-xp">1 910 XP</span>
                </div>
                <div className="rank-row">
                  <span className="rank-pos">3</span>
                  <span className="rank-name">kaiserin</span>
                  <span className="rank-xp">1 340 XP</span>
                </div>
              </div>
              <div className="overlay-card">
                <div className="oc-label">
                  <span>{t("login.scene.mockChat")}</span>
                  <span>{t("login.scene.mockExample")}</span>
                </div>
                <div className="obs-msg">
                  <span className="msg-user" style={{ color: demoContent.messages[0].color }}>
                    {demoContent.messages[0].user}
                  </span>
                  <span className="msg-text">{demoContent.messages[0].text}</span>
                </div>
                <div className="obs-msg">
                  <span className="msg-user" style={{ color: demoContent.messages[1].color }}>
                    {demoContent.messages[1].user}
                  </span>
                  <span className="msg-text">{demoContent.messages[1].text}</span>
                </div>
              </div>
              <p className="obs-foot">{t("login.scene.mockFoot")}</p>
            </div>
          </div>
        </section>

        <section className="section scroll-anchor" id="faq">
          <div className="container">
            <div className="faq-head reveal">
              <h2>{t("login.faqTitle")}</h2>
              <a className="text-link" href="/faq">
                {t("login.faqAll")}
              </a>
            </div>
            <div className="faq-list reveal">
              {FAQ_KEYS.map((key, index) => (
                <details key={key} open={index === 0}>
                  <summary>{t(`faq.items.${key}.q`)}</summary>
                  <p>{t(`faq.items.${key}.a`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section">
          <div className="container">
            <div className="cta-panel reveal">
              <div className="cta-copy">
                <h2>{t("login.finalTitle")}</h2>
                <p>{t("login.finalDesc")}</p>
                <div className="cta-actions">
                  <a className="btn btn-primary" href={loginHref}>
                    {t("login.finalCta")}
                  </a>
                </div>
              </div>
              <div className="cta-avatar">
                <img src={mascot} alt="" width={440} height={762} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div className="footer-brand">
            <img src={logo} alt="" width={128} height={128} />
            <span>VTAmigo</span>
          </div>
          <nav className="footer-links" aria-label={t("login.footerNav")}>
            <a href="#demo">{t("login.nav.demo")}</a>
            <a href="#funciones">{t("login.nav.features")}</a>
            <a href="/faq">{t("login.faq")}</a>
            <a href="/privacy">{t("login.privacy")}</a>
            <a href={loginHref}>{t("login.logIn")}</a>
          </nav>
          <span className="footer-meta">{t("login.footerMeta")}</span>
        </div>
      </footer>
    </div>
  );
}
