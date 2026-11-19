// (d) Policy: the home page's own content policy as the server sends it (read with a same-origin fetch of the page),
// its frame-src, and every securitypolicyviolation seen while this page lived (the probe counts them too).
const seen = [];
document.addEventListener("securitypolicyviolation", (e) => seen.push(`${e.effectiveDirective} ${e.blockedURI}`), true);
if (INJ.wait) await waitFor(INJ.wait, 30000);
await quiet(8000);
const r = await fetch(location.pathname + location.search, { cache: "no-store" });
const csp = r.headers.get("content-security-policy") || "";
const dir = Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(" ")]; }));
const frames = [...document.querySelectorAll("iframe")].map((f) => ({ src: f.getAttribute("src"), sandbox: f.getAttribute("sandbox"), allow: f.getAttribute("allow"), referrerpolicy: f.getAttribute("referrerpolicy") }));
return { csp, frameSrc: dir["frame-src"] ?? null, defaultSrc: dir["default-src"] ?? null, frames, notice: text(document.querySelector(".p-app__notice, .p-app__blocked, [role=status]"), 200), violations: seen };
