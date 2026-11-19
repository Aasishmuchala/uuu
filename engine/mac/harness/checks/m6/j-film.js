// (j) The film player (kit/player.js): the page's <video> plays (muted, so no gesture is needed) and its time moves;
// element full screen: whether this engine offers it to the page (document.fullscreenEnabled; the app turns on
// WKPreferences.isElementFullscreenEnabled), and what the player's own full-screen button does from a script click
// (a real click is a person's gesture; a script's is not, so a refusal here is expected and said).
await quiet(8000);
const v = await waitFor("video", 15000);
const out = { video: !!v, fullscreenEnabled: document.fullscreenEnabled ?? null, webkitFullscreenEnabled: document.webkitFullscreenEnabled ?? null,
  requestFullscreen: v ? typeof v.requestFullscreen : null, webkitEnterFullscreen: v ? typeof v.webkitEnterFullscreen : null };
if (v) {
  v.muted = true;
  out.src = (v.currentSrc || v.src || "").replace(location.origin, "").slice(0, 160);
  try { await v.play(); out.play = "started"; } catch (e) { out.play = `refused: ${e && e.name}`; }
  const t0 = v.currentTime; await sleep(1500);
  out.timeMoved = v.currentTime > t0; out.currentTime = Math.round(v.currentTime * 100) / 100; out.readyState = v.readyState; out.error = v.error ? v.error.code : null;
  out.size = `${v.videoWidth}x${v.videoHeight}`;
  v.pause();
  const fsBtn = [...document.querySelectorAll("button")].find((b) => /full ?screen/i.test(`${b.getAttribute("aria-label") || ""} ${b.textContent}`));
  out.fullscreenButton = fsBtn ? text(fsBtn, 40) || fsBtn.getAttribute("aria-label") : null;
  if (fsBtn) {
    const err = []; const on = () => err.push("fullscreenerror");
    document.addEventListener("fullscreenerror", on); document.addEventListener("webkitfullscreenerror", on);
    fsBtn.click(); await sleep(800);
    out.afterScriptClick = { fullscreenElement: label(document.fullscreenElement || document.webkitFullscreenElement || null), errors: err };
    if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen().catch(() => {});
  }
}
return out;
