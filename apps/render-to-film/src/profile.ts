/**
 * The `profile` procedure's answer. There is no sign-in on this Mac, so the
 * visitor is always the one local owner the gateway names; this keeps the
 * shape the client reads (`name`, `email`, `avatarUrl`). Kept free of SDK and
 * tRPC imports so it can be tested on plain Node.
 */

export interface AppProfile {
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

/** What `gateway.getProfile()` answers. */
export interface LocalProfile {
  id: string;
  name: string;
  email: string | null;
  picture: string | null;
}

export function toAppProfile(p: LocalProfile): AppProfile {
  return { name: p.name || 'You', email: p.email ?? null, avatarUrl: p.picture ?? null };
}
