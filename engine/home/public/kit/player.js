// The player: one take on the stage, its transport and its stills (T35 of PLAN-COOK, the C3 mockup's S04 and
// correction 7). The frame is 16:9 on the stage's own ground with no card round it. Under it, one row: the round
// play button, the time now and the length, mute and full screen. Under that, one scrubber: a 40 px filmstrip of
// the take's stills, the played part a line under them and the time on the playhead. A real <input type="range"> lies over
// the strip as the control a keyboard and a screen reader use; the stills are buttons too.
// `src`, `poster` and `stills` arrive already checked by the page (R3); this part never builds an address.
import { html, useEffect, useRef, useState } from "../vendor/preact-htm.js";
import { cx } from "./util.js";
import { Icon } from "./icon.js";

export const PLAYER_WORDS = Object.freeze({
  group: "This take",
  play: "Play",
  pause: "Pause",
  mute: "Mute",
  unmute: "Unmute",
  full: "Full screen",
  leaveFull: "Leave full screen",
  scrub: "Time in this take",
  stills: "Stills of this take",
  failed: "This clip could not be played.",
  still: (words) => `Still at ${words}`,
  of: (now, length) => `${now} of ${length}`,
});

// Seconds as "m:ss". Pure: anything that is not a finite number, or is below 0, is "0:00".
export function timeWords(s) {
  const n = typeof s === "number" || typeof s === "string" ? Number(s) : NaN;
  const whole = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Which of `count` stills, spread evenly from 0 to `seconds`, is nearest the time `t`. Pure.
export function nearestStill(t, seconds, count) {
  const n = Math.floor(Number(count));
  const len = Number(seconds);
  const at = Number(t);
  if (!(n > 1) || !(len > 0) || !Number.isFinite(at)) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((at / len) * (n - 1))));
}

// The time of still `i` of `count`, spread evenly from 0 to `seconds`.
const stillTime = (i, seconds, count) => (count > 1 && seconds > 0 ? (i * seconds) / (count - 1) : 0);

// A still is an address, or an object with one; anything else is left out.
const stillSrc = (s) => (typeof s === "string" ? s : s && typeof s.src === "string" ? s.src : "");

// Words laid on the picture, one line, each part capped.
const tagLine = (tags) =>
  (Array.isArray(tags) ? tags : [tags])
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.trim().slice(0, 80))
    .join(" · ");

export function Player({ src, poster, stills, seconds, label, tags }) {
  const clip = typeof src === "string" && src ? src : "";
  const list = (Array.isArray(stills) ? stills : []).map(stillSrc).filter(Boolean).slice(0, 24);
  const given = Number(seconds) > 0 && Number.isFinite(Number(seconds)) ? Number(seconds) : 0;

  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const playRef = useRef(null);
  const [t, setT] = useState(0);
  const [length, setLength] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState(false);

  // A new clip starts again from the beginning (only when it changes: on the first showing, an error or a
  // press may already have come before the effects run, and is kept).
  const shown = useRef(clip);
  useEffect(() => {
    if (shown.current === clip) return;
    shown.current = clip;
    setT(0);
    setLength(0);
    setPlaying(false);
    setFailed(false);
  }, [clip]);

  // While it plays, the playhead follows every frame, not only the four time updates a second.
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== "function") return undefined;
    let id = 0;
    const tick = () => {
      const v = videoRef.current;
      if (v && Number.isFinite(v.currentTime)) setT(v.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  useEffect(() => {
    const doc = globalThis.document;
    if (!doc || typeof doc.addEventListener !== "function") return undefined;
    const onChange = () => setFull(Boolean(doc.fullscreenElement) && doc.fullscreenElement === rootRef.current);
    doc.addEventListener("fullscreenchange", onChange);
    return () => doc.removeEventListener("fullscreenchange", onChange);
  }, []);

  const live = Boolean(clip) && !failed;
  const len = (live && length > 0 ? length : 0) || given;
  const now = Math.min(Math.max(0, t), len || 0);
  const share = len > 0 ? now / len : 0;
  const near = nearestStill(now, len, list.length);
  const label2 = typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : PLAYER_WORDS.group;
  const tag = tagLine(tags);

  const video = () => videoRef.current;
  const timeNow = () => {
    const v = live ? video() : null;
    return v && Number.isFinite(v.currentTime) ? v.currentTime : now;
  };
  const seek = (to) => {
    const x = Math.min(Math.max(0, Number(to) || 0), len || 0);
    const v = live ? video() : null;
    if (v) v.currentTime = x;
    setT(x);
  };
  const pause = () => {
    const v = live ? video() : null;
    if (v && typeof v.pause === "function") v.pause();
  };
  const toggle = () => {
    const v = live ? video() : null;
    if (!v) return;
    if (playing || v.paused === false) v.pause();
    else {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  };
  const toggleMute = () => {
    const v = video();
    const next = !muted;
    if (v) v.muted = next;
    setMuted(next);
  };
  const toggleFull = () => {
    const doc = globalThis.document;
    const el = rootRef.current;
    if (doc && doc.fullscreenElement) {
      if (typeof doc.exitFullscreen === "function") doc.exitFullscreen().catch?.(() => {});
    } else if (el && typeof el.requestFullscreen === "function") {
      el.requestFullscreen().catch?.(() => {});
    }
  };

  // Space plays and pauses from anywhere in the player but a button of its own (a still, mute, full screen
  // keep Space as their own press); Left and Right move a second.
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " " || e.key === "Spacebar") {
      const el = e.target;
      if (el && el.localName === "button" && el !== playRef.current) return;
      if (!live) return;
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (!(len > 0)) return;
      e.preventDefault();
      seek(timeNow() + (e.key === "ArrowRight" ? 1 : -1));
    }
  };

  const frameStill = list[near] || "";
  const nowWords = timeWords(now);
  const lenWords = timeWords(len);

  return html`<div class=${cx("k-player", !live && "k-player--stills", full && "k-player--full")} ref=${rootRef}
    role="group" aria-label=${label2} onKeyDown=${onKey}>
    <div class="k-player__frame">
      ${live
        ? html`<video class="k-player__video" ref=${videoRef} src=${clip} poster=${poster || list[0] || undefined}
            preload="metadata" playsinline aria-label=${label2}
            onLoadedMetadata=${(e) => { const d = Number(e.currentTarget.duration); if (Number.isFinite(d) && d > 0) setLength(d); }}
            onTimeUpdate=${(e) => { const c = Number(e.currentTarget.currentTime); if (Number.isFinite(c)) setT(c); }}
            onPlay=${() => setPlaying(true)}
            onPause=${() => setPlaying(false)}
            onEnded=${() => setPlaying(false)}
            onError=${() => { setFailed(true); setPlaying(false); }}></video>`
        : frameStill
          ? html`<img class="k-player__picture" src=${frameStill} alt=${label2} decoding="async" />`
          : null}
      ${tag ? html`<span class="k-player__tag">${tag}</span>` : null}
      ${clip && failed ? html`<p class="k-player__failed" role="status"><${Icon} name="alert" size=${16} />${PLAYER_WORDS.failed}</p>` : null}
    </div>
    <div class="k-player__transport">
      ${live
        ? html`<button class="k-player__play" type="button" ref=${playRef} aria-label=${playing ? PLAYER_WORDS.pause : PLAYER_WORDS.play}
            onClick=${toggle}><${Icon} name=${playing ? "pause" : "play"} size=${16} /></button>`
        : null}
      <span class="k-player__time"><b class="k-player__now">${nowWords}</b><span class="k-player__length"> / ${lenWords}</span></span>
      <span class="k-player__gap"></span>
      ${live
        ? html`<button class=${cx("k-player__btn", muted && "k-player__btn--off")} type="button" aria-pressed=${muted ? "true" : "false"}
            aria-label=${muted ? PLAYER_WORDS.unmute : PLAYER_WORDS.mute} title=${muted ? PLAYER_WORDS.unmute : PLAYER_WORDS.mute}
            onClick=${toggleMute}><${Icon} name=${muted ? "volume-off" : "volume"} size=${16} /></button>`
        : null}
      <button class="k-player__btn" type="button" aria-label=${full ? PLAYER_WORDS.leaveFull : PLAYER_WORDS.full}
        title=${full ? PLAYER_WORDS.leaveFull : PLAYER_WORDS.full} onClick=${toggleFull}><${Icon} name="fullscreen" size=${16} /></button>
    </div>
    <div class=${cx("k-player__track", !list.length && "k-player__track--bare")} style=${`--k-player-at: ${(share * 100).toFixed(3)}%;`}>
      <span class="k-player__played" aria-hidden="true"></span>
      <input class="k-player__range" type="range" min="0" max=${len || 0} step="any" value=${now}
        disabled=${len > 0 ? undefined : true}
        aria-label=${PLAYER_WORDS.scrub} aria-valuetext=${PLAYER_WORDS.of(nowWords, lenWords)}
        onInput=${(e) => { pause(); seek(Number(e.currentTarget.value)); }} />
      ${list.length
        ? html`<div class="k-player__stills" role="group" aria-label=${PLAYER_WORDS.stills}>
            ${list.map((s, i) => {
              const at = stillTime(i, len, list.length);
              return html`<button class="k-player__still" type="button" key=${i} aria-current=${i === near ? "true" : undefined}
                aria-label=${PLAYER_WORDS.still(timeWords(Math.round(at)))}
                onClick=${() => { pause(); seek(at); }}><img src=${s} alt="" decoding="async" /></button>`;
            })}
          </div>`
        : null}
      <span class="k-player__head" aria-hidden="true"><span class="k-player__head-time">${nowWords}</span></span>
    </div>
  </div>`;
}
