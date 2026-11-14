// Opening a file an agent can write without following a link anywhere on its path (T57 F1). O_NOFOLLOW guards the
// last part of a path only: a folder on the way swapped for a link between a check and the open is followed, so
// an unfenced reader (the home server) could be raced into reading a file the agent's fence denies it. macOS's
// O_NOFOLLOW_ANY refuses a link in any part of the path, at the open itself (ELOOP), so nothing checked before the
// open can be raced. It is given instead of O_NOFOLLOW (both together are EINVAL).
// The path must be a real path: a link in the trusted part of it (/var, /tmp on this Mac) is refused too, so a
// caller resolves its own root once (realpathSync) and joins the agent's names onto that.
// Zero dependencies; used by the viewer's site reader and every home server reader of agent-written files.
import { constants, openSync } from "node:fs";

// 0x20000000 on macOS (sys/fcntl.h); Node names it only on some versions. Other systems keep O_NOFOLLOW.
export const O_NOFOLLOW_ANY = constants.O_NOFOLLOW_ANY ?? (process.platform === "darwin" ? 0x20000000 : 0);

// Read-only, no link anywhere on the path, and O_NONBLOCK (a FIFO or a device cannot hang the reader).
export const READ_NO_LINKS = constants.O_RDONLY | (O_NOFOLLOW_ANY || constants.O_NOFOLLOW) | (constants.O_NONBLOCK || 0);

// A descriptor of `path` opened read-only with no link anywhere on the path (the caller checks what it is with
// fstat on the descriptor, reads from it and closes it). Throws as openSync does: ELOOP when a link is on the way.
export function openNoLinks(path, extraFlags = 0) {
  return openSync(path, READ_NO_LINKS | extraFlags);
}
