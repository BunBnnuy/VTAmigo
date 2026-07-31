// Tier-based limits for message batching (time window + messages per batch)
// and the manual "Now" trigger button. Tiers are assigned per-user by an
// admin in /admin (see backend/adminAuth.js's /admin/users/:twitchId/tier).
//
// `windowOptions`/`messageOptions` of `null` means free-form (Pro only) —
// Settings.jsx renders a number input instead of a <select> in that case.
export const TIERS = {
  free: {
    windowOptions: [600],
    messageOptions: [30],
    nowCooldownMs: 0,
    nowLimitPerSession: 1,
  },
  basic: {
    windowOptions: [300, 600],
    messageOptions: [10, 20],
    nowCooldownMs: 10 * 60 * 1000,
    nowLimitPerSession: Infinity,
  },
  advanced: {
    windowOptions: [20, 30, 60, 120, 300, 600],
    messageOptions: [10, 20, 30],
    nowCooldownMs: 5 * 60 * 1000,
    nowLimitPerSession: Infinity,
  },
  pro: {
    windowOptions: null,
    messageOptions: null,
    nowCooldownMs: 0,
    nowLimitPerSession: Infinity,
  },
};

export function tierLimits(tier) {
  return TIERS[tier] || TIERS.pro;
}

// Clamp saved batchWindow/maxMessages to whatever the current tier allows —
// settings saved under a higher tier (or before tiers existed) may fall
// outside a lower tier's fixed option list after a downgrade.
export function clampToTier(tier, { batchWindow, maxMessages }) {
  const limits = tierLimits(tier);
  const clampedWindow = limits.windowOptions
    ? closestOption(limits.windowOptions, batchWindow)
    : batchWindow;
  const clampedMessages = limits.messageOptions
    ? closestOption(limits.messageOptions, maxMessages)
    : maxMessages;
  return { batchWindow: clampedWindow, maxMessages: clampedMessages };
}

function closestOption(options, value) {
  if (options.includes(value)) return value;
  return options.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best
  , options[0]);
}
