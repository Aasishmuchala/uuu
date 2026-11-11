# The eight creatures

One small pixel creature for the company brain and for each department. The new home screen shows them in the dock, on the map and beside an agent's name. They are our own: drawn here, as scripts, for the company engine. Nothing is copied from any other product.

Each is 16 × 16 pixels, four frames of a gentle idle (0.4 s each, 1.6 s in all, one tag `idle`), a clear background, a one-pixel dark outline, two-pixel eyes, the department's dark-theme colour as its body, and five colours.

| Id | What it is | Its idle |
|---|---|---|
| `brain` | a two-lobed brain on stubby feet, pearl | a spark, a blink, a small bob |
| `operations` | a square little robot with an antenna light, indigo | the light blinks, the eyes blink, a bob |
| `sales` | a round songbird, the one that carries the message, coral | it waves a wing, then blinks |
| `marketing` | a round caller with a cone-shaped crest, violet | rings of sound go out, then a bob and a blink |
| `studio` | a drop of paint whose tip is still wet with coral, teal | the wet tip shines, a blink, a squash |
| `support` | a helper wearing a headset, sky blue | it lifts a hand, then blinks |
| `people` | a sunflower face on a stem with two leaves, amber | it sways one way and the other, and blinks |
| `books` | a little ledger standing on two feet, green | a blink and a bob |

## Drawing one again

Run the script with the Artist's Python and the repo's sprite tool, in a scratch folder (the tool writes beside the script):

```
mkdir -p /tmp/creature && cp engine/art/creatures/brain.py /tmp/creature/ && cd /tmp/creature
~/.paperclip/uuu-engine/art/venv/bin/python <repo>/engine/art/sprite.py brain.py
```

Then copy `brain-sheet.png` and `brain.json` into `engine/home/public/next/assets/creatures/` (after the switch, `engine/home/public/assets/creatures/`) and, if the frame count or times changed, its line in `kit/creature-data.js`. `test/creature.test.mjs` checks that the two agree. Keep four to six frames whose times add up to 1.6 s.
