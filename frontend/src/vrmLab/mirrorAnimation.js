// Mirrors a VRMA (VRM Animation) across the character's sagittal plane:
// swap left/right humanoid tracks and reflect the local rotations/hips
// translation. This doubles every clip without downloading anything and is the
// cheapest way to make repeated gestures look less repetitive.
//
// Rotation reflection: for a reflection across the YZ plane an axis
// (x, y, z) becomes (x, -y, -z), so a quaternion (x, y, z, w) becomes
// (x, -y, -z, w) — pitch is preserved, yaw and roll are reversed.

import { QuaternionKeyframeTrack, VectorKeyframeTrack } from "three";

function otherSide(name) {
  if (name.startsWith("left") && name.length > 4 && name[4] === name[4].toUpperCase()) {
    return `right${name.slice(4)}`;
  }
  if (name.startsWith("right") && name.length > 5 && name[5] === name[5].toUpperCase()) {
    return `left${name.slice(5)}`;
  }
  return name;
}

export function mirrorVRMAnimation(animation) {
  const mirrored = {
    duration: animation.duration,
    restHipsPosition: animation.restHipsPosition?.clone?.() || animation.restHipsPosition,
    humanoidTracks: { rotation: new Map(), translation: new Map() },
    expressionTracks: {
      preset: new Map(animation.expressionTracks?.preset || []),
      custom: new Map(animation.expressionTracks?.custom || []),
    },
    lookAtTrack: animation.lookAtTrack?.clone?.() || null,
  };

  if (mirrored.restHipsPosition) mirrored.restHipsPosition.x *= -1;

  for (const [name, track] of animation.humanoidTracks.rotation) {
    const values = Array.from(track.values);
    for (let i = 0; i < values.length; i += 4) {
      values[i + 1] *= -1; // y
      values[i + 2] *= -1; // z
    }
    const mirroredName = otherSide(name);
    mirrored.humanoidTracks.rotation.set(
      mirroredName,
      new QuaternionKeyframeTrack(
        `${mirroredName}.quaternion`,
        Array.from(track.times),
        values
      )
    );
  }

  for (const [name, track] of animation.humanoidTracks.translation) {
    const values = Array.from(track.values);
    for (let i = 0; i < values.length; i += 3) values[i] *= -1; // x
    const mirroredName = otherSide(name);
    mirrored.humanoidTracks.translation.set(
      mirroredName,
      new VectorKeyframeTrack(`${mirroredName}.position`, Array.from(track.times), values)
    );
  }

  return mirrored;
}

export function mirroredEntry(entry) {
  return {
    ...entry,
    id: `${entry.id}~m`,
    label: `${entry.label} (espejo)`,
    mirror: true,
  };
}
