// One list for every TTS voice, regardless of engine.
//
// The Settings and Quick Controls panels used to show a provider select plus a
// second select whose contents changed with it. That made comparing voices
// awkward ("what Piper voices do I have?" required switching provider first).
// Now every engine's voices live in a single <select>, each labelled
// "Provider/Voice" (Windows/Microsoft Raúl, Piper/Mario, Kokoro/Santa, ...).
// Picking a voice also picks its engine, so there is only one thing to save.

export const VOICE_FIELDS = {
  windows: "voiceURI",
  piper: "piperVoice",
  kitten: "kittenVoice",
  kokoro: "kokoroVoice",
};

export const PROVIDERS = ["windows", "piper", "kitten", "kokoro"];

const PROVIDER_LABELS = {
  windows: "Windows",
  browser: "Browser",
  piper: "Piper",
  kitten: "Kitten",
  kokoro: "Kokoro",
};

// Voice ids can contain ":" (browser voiceURIs occasionally do), so the
// provider is split at the first colon and the voice part is URI-encoded.
export function encodeVoiceValue(provider, voice) {
  return `${provider}:${encodeURIComponent(voice || "")}`;
}

export function parseVoiceValue(value) {
  const text = String(value || "");
  const separator = text.indexOf(":");
  if (separator === -1) return { provider: "windows", voice: "" };
  const provider = text.slice(0, separator);
  if (!VOICE_FIELDS[provider]) return { provider: "windows", voice: "" };
  let voice = "";
  try {
    voice = decodeURIComponent(text.slice(separator + 1));
  } catch {
    voice = text.slice(separator + 1);
  }
  return { provider, voice };
}

// Value the <select> should show for the settings currently in effect.
export function selectedVoiceValue(settings = {}) {
  const provider = VOICE_FIELDS[settings.ttsProvider] ? settings.ttsProvider : "windows";
  return encodeVoiceValue(provider, settings[VOICE_FIELDS[provider]] || "");
}

// Patch to merge into settings when the user picks a different voice.
// Only the chosen engine's voice is overwritten; the others keep their last
// selection so switching back and forth does not lose it.
export function voiceSelectionPatch(value) {
  const { provider, voice } = parseVoiceValue(value);
  return { ttsProvider: provider, [VOICE_FIELDS[provider]]: voice };
}

function label(provider, voice, t) {
  return `${PROVIDER_LABELS[provider] || provider}/${voice || t("ttsVoices.providerDefault")}`;
}

// Flat "Provider/Voice" list: Windows first (the default engine), then the
// local engines in the order they were added.
export function buildVoiceOptions({ voices = [], piperVoices = [], kittenVoices = [], kokoroVoices = [], t }) {
  const options = [{ value: encodeVoiceValue("windows", ""), label: label("windows", "", t) }];
  for (const voice of voices) {
    // speechSynthesis mixes Windows SAPI voices with the browser's own ones
    // (Chrome ships "Google ..." voices). Label each by where it comes from so
    // the list reads "Windows/Microsoft Raúl" and "Browser/Google español".
    const source = /^Microsoft\b/i.test(voice.name) ? "windows" : "browser";
    options.push({
      value: encodeVoiceValue("windows", voice.voiceURI),
      label: `${PROVIDER_LABELS[source] || "Browser"}/${voice.name}`,
    });
  }

  options.push({ value: encodeVoiceValue("piper", ""), label: label("piper", "", t) });
  for (const voice of piperVoices) {
    options.push({ value: encodeVoiceValue("piper", voice.id), label: label("piper", voice.name, t) });
  }

  options.push({ value: encodeVoiceValue("kitten", ""), label: label("kitten", "", t) });
  for (const voice of kittenVoices) {
    options.push({ value: encodeVoiceValue("kitten", voice.id), label: label("kitten", voice.name, t) });
  }

  options.push({ value: encodeVoiceValue("kokoro", ""), label: label("kokoro", "", t) });
  for (const voice of kokoroVoices) {
    options.push({ value: encodeVoiceValue("kokoro", voice.id), label: label("kokoro", voice.name, t) });
  }

  return options;
}

// Keeps the select meaningful when the saved voice is not in the freshly
// fetched list (provider unavailable, voice file deleted, fetch failed).
export function withSelectedOption(options, value, t) {
  if (!value || options.some((option) => option.value === value)) return options;
  const { provider, voice } = parseVoiceValue(value);
  const source = provider === "windows" && voice && !/^Microsoft\b/i.test(voice) ? "browser" : provider;
  return [{ value, label: label(source, voice, t) }, ...options];
}
