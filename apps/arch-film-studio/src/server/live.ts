/**
 * The pipeline, the door and the upload built from the real collaborators:
 * the engine socket, `$APP_DATA`, sharp and this Mac's ffmpeg.
 */
import { runClaude } from '../local/claude.ts';
import { createDoor } from '../local/door.ts';
import { engine } from '../local/engine.ts';
import { probe, runMediaOp } from '../local/media-ops.ts';
import { pictures } from '../local/pictures.ts';
import { store } from '../storage.ts';
import { createPipeline } from './pipeline.ts';
import { sharpCopies, type UploadDeps } from './upload.ts';

export const door = createDoor({ engine, store, pictures });

export const pipeline = createPipeline({
  door,
  store,
  pictures,
  claude: (options) => runClaude({ engine, store, pictures }, options),
  media: (op) => runMediaOp(op, { store }),
  probe: (key) => probe(key, { store }),
});

export const uploadDeps: UploadDeps = { store, copies: sharpCopies() };
