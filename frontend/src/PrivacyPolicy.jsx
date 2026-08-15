// The contents below were written by reading what the code actually does
// (backend/auth.js, db.js, claude.js, analytics.js).
// If you add a new third-party service or start storing a new field, this page
// needs updating too — nothing here is generated automatically.
import React from "react";
import logo from "./img/logo.png";

const LAST_UPDATED = "11 August 2026";
const CONTACT_EMAIL = "privacy@vtamigo.top";

export default function PrivacyPolicy() {
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <a href="/" style={styles.brand}>
          <img src={logo} alt="" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
        </a>
        <a href="/" style={styles.headerBtn}>Back to site</a>
      </header>

      <main style={styles.main}>
        <h1 style={styles.title}>Privacy Policy</h1>
        <p style={styles.updated}>Last updated: {LAST_UPDATED}</p>

        <p style={styles.lead}>
          VTAmigo is an AI co-host for Twitch streamers. It reads your chat,
          replies out loud, and drives overlays in OBS. Doing that means
          handling data about you, and about the people who chat in your
          channel. This page explains exactly what we store, where it goes,
          and what you can do about it.
        </p>

        <p style={styles.note}>
          This policy is written in English only. Translating legal text we
          haven't verified would risk changing its meaning, so the English
          version is the one that applies.
        </p>

        <Section title="Who this covers">
          <p style={styles.p}>
            Two groups of people appear in this policy:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Streamers</strong> — you, if you've logged in with Twitch
              and connected your channel.
            </li>
            <li style={styles.li}>
              <strong>Viewers</strong> — people who chat in a channel running
              VTAmigo. Viewers never sign up, but their public Twitch activity
              does pass through and is partly stored. See{" "}
              <a href="#viewers" style={styles.link}>Data about your viewers</a>.
            </li>
          </ul>
        </Section>

        <Section title="What we collect from streamers">
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Twitch account details</strong> — your Twitch user ID,
              login name, display name, and profile image URL.
            </li>
            <li style={styles.li}>
              <strong>Twitch access tokens</strong> — so the app can act on your
              behalf. These are <strong>encrypted at rest</strong>. If you link
              a separate bot account, its tokens are stored the same way.
            </li>
            <li style={styles.li}>
              <strong>Your settings</strong> — base prompt, voice choice,
              overlay layouts, chat overlay configuration, and similar
              preferences.
            </li>
            <li style={styles.li}>
              <strong>Usage records</strong> — timestamps and AI token counts
              per request, used for tier limits and cost tracking.
            </li>
            <li style={styles.li}>
              <strong>Error reports</strong> — if the app hits an error, we log
              the message, stack trace, page URL, your browser's user-agent
              string, and your Twitch login, so we can fix it.
            </li>
          </ul>
        </Section>

        <Section title="Twitch permissions we ask for">
          <p style={styles.p}>
            When you log in, Twitch asks you to approve a specific set of
            permissions. We request only these, and we use each one:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}><code style={styles.code}>chat:read</code> / <code style={styles.code}>chat:edit</code> — read your chat and post replies.</li>
            <li style={styles.li}><code style={styles.code}>channel:read:redemptions</code> — react to channel point redemptions.</li>
            <li style={styles.li}><code style={styles.code}>moderator:read:followers</code> — react to new followers.</li>
            <li style={styles.li}><code style={styles.code}>channel:read:subscriptions</code> — react to subs and resubs.</li>
            <li style={styles.li}><code style={styles.code}>bits:read</code> — react to cheers.</li>
            <li style={styles.li}><code style={styles.code}>channel:manage:broadcast</code> — update your stream title or category when you use a voice command to do so.</li>
          </ul>
          <p style={styles.p}>
            We never request permission to read your email, your payouts, or
            your private messages.
          </p>
        </Section>

        <Section title="Where your data goes" id="third-parties">
          <p style={styles.p}>
            VTAmigo sends data to other companies in order to work. Each one
            receives only what that feature needs:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>AI providers</strong> — to generate responses, we send the
              relevant chat messages, your base prompt, and related stream
              context to the AI provider configured for your account. Depending
              on that configuration this may be{" "}
              <strong>Anthropic (Claude)</strong>, <strong>OpenAI</strong>, or{" "}
              <strong>xAI (Grok)</strong>. Chat text from your viewers is
              included in what is sent.
            </li>
            <li style={styles.li}>
              <strong>Twitch</strong> — we call Twitch's API to read chat and
              events and to post messages as you.
            </li>
            <li style={styles.li}>
              <strong>Umami</strong> — privacy-focused analytics. See{" "}
              <a href="#analytics" style={styles.link}>Analytics and cookies</a>.
            </li>
            <li style={styles.li}>
              <strong>Emote providers</strong> — 7TV, BetterTTV and FrankerFaceZ,
              to display third-party emotes in chat.
            </li>
            <li style={styles.li}>
              <strong>YouTube</strong> — only when you use the video queue, to
              fetch that public content.
            </li>
            <li style={styles.li}>
              <strong>Google Fonts</strong> — the site loads its fonts from
              Google, which means Google sees the request.
            </li>
          </ul>
          <p style={styles.p}>
            We do not sell your data, and we don't share it with advertisers.
          </p>
        </Section>

        <Section title="Analytics and cookies" id="analytics">
          <p style={styles.p}>
            We use Umami for analytics. It doesn't use tracking cookies and
            doesn't build advertising profiles. Analytics events are sent with
            your IP address, browser user-agent, and — when you're logged in —{" "}
            <strong>your Twitch login name</strong>, so these events are not
            fully anonymous to us.
          </p>
          <p style={styles.p}>
            We set one cookie of our own: a login session cookie. It is
            HTTP-only (JavaScript can't read it), restricted to same-site
            requests, and expires after 30 days. There is also a short-lived
            cookie used only during the Twitch login handshake. We do not use
            advertising or cross-site tracking cookies.
          </p>
        </Section>

        <Section title="Data about your viewers" id="viewers">
          <p style={styles.p}>
            People who chat in your channel don't sign up for VTAmigo, but
            their public activity passes through it. Specifically:
          </p>
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Chat messages are sent to the AI provider</strong> so it
              can reply in context.
            </li>
            <li style={styles.li}>
              <strong>Leveling data is stored</strong> — if you enable the XP
              system, we keep each chatter's Twitch username, display colour,
              XP, and message count for your channel.
            </li>
            <li style={styles.li}>
              <strong>Stream events are stored</strong> — follows, subs, gift
              subs, raids and cheers are recorded with the username involved,
              so overlays and reactions can refer to them.
            </li>
          </ul>
          <p style={styles.p}>
            As the streamer, you are responsible for telling your community
            that an AI co-host is reading chat. If a viewer wants their
            leveling data removed, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={styles.link}>{CONTACT_EMAIL}</a>.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p style={styles.p}>
            Account data, settings, leveling data and activity history are kept
            for as long as your account exists — they are not deleted on a
            schedule. Usage and error logs are likewise retained until removed
            by hand. If you want your data deleted, ask us and we'll remove it.
          </p>
        </Section>

        <Section title="Your choices">
          <ul style={styles.ul}>
            <li style={styles.li}>
              <strong>Disconnect Twitch</strong> — you can revoke VTAmigo's
              access at any time from{" "}
              <a href="https://www.twitch.tv/settings/connections" style={styles.link} target="_blank" rel="noopener noreferrer">
                Twitch's Connections settings
              </a>. That immediately stops us acting on your behalf.
            </li>
            <li style={styles.li}>
              <strong>Delete your data</strong> — email{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} style={styles.link}>{CONTACT_EMAIL}</a>{" "}
              and we'll delete your account and associated data.
            </li>
            <li style={styles.li}>
              <strong>Text-to-speech stays here</strong> — the co-host speaks
              with a voice from your own browser or with a Piper voice running
              on our server, so spoken text is not sent to a TTS vendor.
            </li>
            <li style={styles.li}>
              <strong>Ask what we hold</strong> — email us for a copy of the
              data associated with your account.
            </li>
          </ul>
        </Section>

        <Section title="Security">
          <p style={styles.p}>
            Your Twitch access and refresh tokens are encrypted before being
            stored. Traffic to the site is served over HTTPS. No system is
            perfectly secure, but we try not to hold anything we don't need.
          </p>
        </Section>

        <Section title="Children">
          <p style={styles.p}>
            VTAmigo is not intended for anyone under 13, and it requires a
            Twitch account, which has its own age requirements.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p style={styles.p}>
            If this policy changes in a way that meaningfully affects you,
            we'll update the date at the top of this page. Continuing to use
            VTAmigo after a change means you accept the updated policy.
          </p>
        </Section>

        <Section title="Contact">
          <p style={styles.p}>
            Questions about privacy, or a request to delete your data:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} style={styles.link}>{CONTACT_EMAIL}</a>.
          </p>
        </Section>
      </main>

      <footer style={styles.footer}>
        <a href="/" style={styles.link}>Home</a>
        <span style={styles.footerSep}>·</span>
        <a href="/faq" style={styles.link}>FAQ</a>
      </footer>
    </div>
  );
}

function Section({ title, id, children }) {
  return (
    <section style={styles.section} id={id}>
      <h2 style={styles.h2}>{title}</h2>
      {children}
    </section>
  );
}

const styles = {
  // index.css locks html/body/#root to overflow:hidden for the app shell, so
  // long standalone pages have to be their own scroll container. This needs a
  // fixed height, not minHeight — with minHeight the element just grows past
  // #root and gets clipped, and overflowY never engages. Same as Login.jsx.
  page: {
    height: "100vh",
    background: "var(--bg, #0e0e10)",
    color: "var(--text, #efeff1)",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: "1px solid var(--border, #2a2a2e)",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    textDecoration: "none",
  },
  brandIcon: { width: 28, height: 28, objectFit: "contain" },
  brandName: {
    fontFamily: "'Quicksand', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 18,
    color: "var(--accent-light, #f0429b)",
    letterSpacing: "-0.01em",
  },
  headerBtn: {
    padding: "8px 16px",
    borderRadius: 9,
    textDecoration: "none",
    background: "var(--surface2, #1f1f23)",
    color: "var(--text, #efeff1)",
    border: "1px solid var(--border, #2a2a2e)",
    fontWeight: 600,
    fontSize: 13,
  },
  main: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "48px 24px 24px",
  },
  title: {
    margin: 0,
    fontSize: 38,
    fontWeight: 800,
    letterSpacing: "-0.02em",
  },
  updated: {
    margin: "10px 0 0",
    fontSize: 13,
    color: "var(--text-muted, #adadb8)",
  },
  lead: {
    margin: "28px 0 0",
    fontSize: 17,
    lineHeight: 1.7,
  },
  note: {
    margin: "16px 0 0",
    fontSize: 13,
    lineHeight: 1.6,
    color: "var(--text-muted, #adadb8)",
  },
  section: { marginTop: 40 },
  h2: {
    margin: "0 0 12px",
    fontSize: 20,
    fontWeight: 700,
  },
  p: {
    margin: "0 0 12px",
    fontSize: 15,
    lineHeight: 1.75,
    color: "var(--text-muted, #adadb8)",
  },
  ul: {
    margin: "0 0 12px",
    paddingLeft: 22,
    fontSize: 15,
    lineHeight: 1.75,
    color: "var(--text-muted, #adadb8)",
  },
  li: { marginBottom: 10 },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 13,
    padding: "1px 6px",
    borderRadius: 5,
    background: "var(--surface2, #1f1f23)",
    border: "1px solid var(--border, #2a2a2e)",
    color: "var(--text, #efeff1)",
  },
  link: { color: "var(--accent-light, #f0429b)" },
  footer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: "32px 24px 48px",
    fontSize: 13,
    color: "var(--text-muted, #adadb8)",
  },
  footerSep: { color: "var(--text-muted, #adadb8)" },
};
