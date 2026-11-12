// The eight creatures: frame count, frame size and each frame's time in milliseconds, one per id.
// Read from assets/creatures/<id>.json, which engine/art/sprite.py wrote from engine/art/creatures/<id>.py.
// If a creature is drawn again, update its line here; test/creature.test.mjs checks they match.
export const CREATURES = Object.freeze({
  brain: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  operations: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  sales: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  marketing: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  studio: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  support: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  people: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
  books: Object.freeze({ frames: 4, w: 16, h: 16, durations: Object.freeze([400, 400, 400, 400]) }),
});

export const CREATURE_IDS = Object.freeze(Object.keys(CREATURES));
