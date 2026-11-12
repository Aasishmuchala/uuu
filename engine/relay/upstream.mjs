// The one outside address the engine sends model calls to (CONTRACTS C1). It is not a
// setting: code that takes an upstream accepts exactly this origin, or a stand-in on
// http://127.0.0.1:<port> in tests, and throws on anything else.
export const PROVIDER_ORIGIN = "https://api.omegaplusapi.com";
export const PROVIDER_NAME = "Omega Plus";

const STAND_IN = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/;

// Returns { origin, protocol, hostname, port } for an accepted origin; throws otherwise.
// The text is compared as given: no trailing slash, no path, no user, no other spelling.
export function checkOrigin(origin) {
  if (origin === PROVIDER_ORIGIN) {
    return { origin, protocol: "https:", hostname: "api.omegaplusapi.com", port: 443 };
  }
  const m = typeof origin === "string" ? STAND_IN.exec(origin) : null;
  if (m && Number(m[1]) <= 65535) {
    return { origin, protocol: "http:", hostname: "127.0.0.1", port: Number(m[1]) };
  }
  throw new Error(`upstream must be ${PROVIDER_ORIGIN} or a stand-in on http://127.0.0.1:<port>`);
}
