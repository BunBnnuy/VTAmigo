// Per-account VTube Studio manager. Each approved tunnel (the owner's own
// device or a co-streamer's) gets its own independent connection, animation
// loop, and phoneme scheduler, keyed by twitchId — so one account's speech
// never disconnects another's VTS instance.
const vtube = require("./vtube");
const { createAnimationController } = require("./animations");
const { createPhonemeScheduler } = require("./phonemes");
const { getApprovedDeviceForUser, listApprovedDeviceOwners } = require("./devices");

const contexts = new Map(); // twitchId -> { connection, animations, phonemes }

// Returns null if this account has no approved tunnel — callers should treat
// that as "nowhere to send VTS data" rather than falling back to someone
// else's connection.
function getContext(twitchId) {
  const device = getApprovedDeviceForUser(twitchId);
  if (!device) return null;

  const url = `ws://localhost:${device.assignedPort}`;
  let ctx = contexts.get(twitchId);
  if (!ctx) {
    const connection = vtube.createConnection(url);
    ctx = {
      connection,
      animations: createAnimationController(connection.injectParam),
      phonemes: createPhonemeScheduler(connection.injectParam),
    };
    contexts.set(twitchId, ctx);
  } else if (ctx.connection.getStatus().url !== url) {
    ctx.connection.setConfig({ url });
  }
  return ctx;
}

// Reconnect every already-approved tunnel at boot, so idle animation starts
// immediately instead of waiting for that account's first request.
function bootstrap() {
  for (const twitchId of listApprovedDeviceOwners()) {
    getContext(twitchId);
  }
}

module.exports = { getContext, bootstrap };
