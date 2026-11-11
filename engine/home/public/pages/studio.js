// Studio page (CONTRACTS-V2 9.6, 17.8, 20.3): sprites and animations with a player, images, CAD parts and other
// files, files that could not be used, and the ready-made goals strip. Everything shown is text or a picture
// from a file an agent made; nothing here is followed or run.
import { html, useState, useEffect } from "../vendor/preact-htm.js";
import { useResource } from "../lib/api.js";
import { useApp } from "../lib/context.js";
import {
  AgentChip, BeingBuilt, Card, DataTable, Empty, ErrorNotice, FileCard, Loading, NotConnected, PageHeader, Section, Switch, Tag,
} from "../kit/index.js";

const THUMB = 64;
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// The style that shows only the first frame of a sprite sheet inside a square box of `box` pixels. The sheet is a
// strip of `frames` frames side by side. The frame is scaled by a whole number when it can be, else shrunk to fit.
export function thumbStyle(sprite, box = THUMB) {
  const w = num(sprite?.frameSize?.w, 1);
  const h = num(sprite?.frameSize?.h, 1);
  const frames = Math.max(1, Math.floor(num(sprite?.frames, 1)));
  const side = num(box, THUMB);
  const raw = side / Math.max(w, h);
  const scale = raw >= 1 ? Math.floor(raw) : raw;
  const url = sprite?.sheet?.viewUrl ? `url("${String(sprite.sheet.viewUrl).replace(/["\\()\s]/g, "")}")` : "none";
  return [
    `width:${Math.round(w * scale)}px`, `height:${Math.round(h * scale)}px`,
    `background-image:${url}`, "background-repeat:no-repeat", "background-position:0 0",
    `background-size:${Math.round(w * frames * scale)}px ${Math.round(h * scale)}px`, "image-rendering:pixelated",
  ].join(";");
}

// The line under a sprite: a tick when the frames match their tags, else a warning in plain words.
export function checkLine(checks) {
  return checks?.ok
    ? { ok: true, text: "Frames match the tags" }
    : { ok: false, text: "The frames and the tags do not match" };
}

const tagNames = (sprite) => (sprite?.tags || []).map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean).slice(0, 12);

function SpriteCard({ sprite, chosen, onChoose }) {
  const line = checkLine(sprite.checks);
  const names = tagNames(sprite);
  return html`
    <li class=${`p-studio__sprite${chosen ? " p-studio__sprite--chosen" : ""}`}>
      <button type="button" class="p-studio__sprite-button" aria-pressed=${chosen ? "true" : "false"} onClick=${() => onChoose(sprite.id)}>
        <span class="p-studio__thumb-box" aria-hidden="true"><span class="p-studio__thumb" style=${thumbStyle(sprite)}></span></span>
        <span class="p-studio__sprite-text">
          <span class="p-studio__sprite-title">${sprite.title || sprite.name}</span>
          <span class="p-studio__sprite-meta">${sprite.frames} frames</span>
          ${names.length ? html`<span class="p-studio__tags">${names.map((n) => html`<${Tag} key=${n}>${n}<//>`)}</span>` : null}
          <span class=${`p-studio__check${line.ok ? "" : " p-studio__check--warn"}`}>${line.ok ? "\u2713 " : ""}${line.text}</span>
        </span>
      </button>
    </li>`;
}

function Player({ id, query }) {
  const res = useResource(id ? `/api/studio/art/sprite?id=${encodeURIComponent(id)}` : null);
  const [mod, setMod] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    import("../studio/sprite-player.js").then((m) => { if (alive) setMod(m); }, () => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, []);
  const d = res.data;
  return html`
    <div class="p-studio__player">
      ${res.loading && !d ? html`<${Loading} lines=${4} label="Loading the animation" />` : null}
      ${res.error ? html`<${ErrorNotice} error=${res.error} onRetry=${res.reload} />` : null}
      ${missing || (!mod && !res.loading) ? html`<${BeingBuilt} title="Animation player" />` : null}
      ${d && mod?.SpritePlayer ? html`
        <${mod.SpritePlayer}
          sheetUrl=${d.sprite?.sheet?.viewUrl} frames=${d.frames} tags=${d.tags} palette=${d.sprite?.palette}
          title=${d.sprite?.title} gif=${d.sprite?.gif}
          initialTag=${query?.get("tag") || ""} initialFrame=${query?.get("frame") || ""} />` : null}
    </div>`;
}

const pick = (sections, id) => (sections || []).find((s) => s.id === id);

function FilesTable({ section }) {
  if (!section) return null;
  const columns = (section.columns || []).filter((c) => c.key !== "file");
  return html`
    <${Section} title=${section.title} count=${section.rows?.length}>
      <${DataTable} columns=${[...columns, { key: "file", label: "File" }]} rows=${section.rows || []} emptyText=${section.emptyText}
        renderCell=${(row, col) => (col.key === "file"
          ? (row.fileUrl ? html`<a href=${row.fileUrl} download>Download</a>` : "")
          : undefined)} />
    <//>`;
}

export default function Page({ route }) {
  const { openComposer } = useApp();
  const art = useResource("/api/studio/art", { every: 15000 });
  const dept = useResource("/api/departments/studio", { every: 15000 });
  const gallery = useResource("/api/gallery");
  const a = art.data;
  const d = dept.data;
  const sprites = a?.sprites || [];
  const images = a?.images || [];
  const problems = a?.problems || [];
  const sprite = route?.query?.get("sprite") || "";
  const choose = (id) => { if (typeof location !== "undefined") location.hash = `#/studio?sprite=${encodeURIComponent(id)}`; };
  const strip = (gallery.data?.departments || []).find((x) => x.id === "studio");
  const goals = (strip?.goals || []).slice(0, 3);
  const cad = pick(d?.sections, "cad");
  const files = pick(d?.sections, "files");
  return html`
    <div class="p-studio">
      <${PageHeader} title="Studio" lead="Drawings, animations and parts made by the Drafter and the Artist.">
        <${AgentChip} agent=${{ slug: "drafter", name: "Drafter" }} />
        <${AgentChip} agent=${{ slug: "artist", name: "Artist" }} />
      <//>
      ${(art.loading && !a) || (dept.loading && !d) ? html`<${Loading} lines=${4} label="Loading the Studio" />` : null}
      <${ErrorNotice} error=${art.error} onRetry=${art.reload} />
      <${ErrorNotice} error=${dept.error} onRetry=${dept.reload} />
      ${a?.notConnected ? html`<${NotConnected} reason=${a.notConnected.reason} next=${a.notConnected.next} />` : null}
      ${d?.notConnected ? html`<${NotConnected} reason=${d.notConnected.reason} next=${d.notConnected.next} />` : null}
      ${a ? html`
        <${Section} title="Sprites and animations" count=${sprites.length}>
          ${sprite ? html`<${Player} key=${sprite} id=${sprite} query=${route?.query} />` : null}
          ${sprites.length ? html`
            <ul class="p-studio__sprites">
              ${sprites.map((s) => html`<${SpriteCard} key=${s.id} sprite=${s} chosen=${s.id === sprite} onChoose=${choose} />`)}
            </ul>` : html`<${Empty} title="No sprites yet." text="Ask the Artist for one from a ready-made goal below." />`}
        <//>
        <${Section} title="Images" count=${images.length}>
          ${images.length ? html`
            <ul class="p-studio__images">
              ${images.map((im) => html`
                <li key=${im.id} class="p-studio__image">
                  ${im.file?.viewUrl ? html`<img class="p-studio__picture" src=${im.file.viewUrl} alt=${im.title || im.name} loading="lazy" />` : null}
                  <p class="p-studio__image-title">${im.title || im.name}</p>
                  <${FileCard} file=${im.file} />
                </li>`)}
            </ul>` : html`<${Empty} title="No images yet." />`}
        <//>` : null}
      ${d ? html`<${FilesTable} section=${cad} /><${FilesTable} section=${files} />` : null}
      ${problems.length ? html`
        <${Section} title="Files that could not be used">
          <ul class="p-studio__problems">
            ${problems.map((p, i) => html`<li key=${i}><strong>${p.name}</strong> ${p.problem}</li>`)}
          </ul>
        <//>` : null}
      ${goals.length ? html`
        <${Section} title="Ready-made goals" aside=${html`<a href="#/gallery?d=studio">All ready-made goals</a>`}>
          <div class="p-studio__strip">
            ${goals.map((g) => html`
              <${Card} key=${g.id} onClick=${() => openComposer({ text: g.text, to: g.to, planFirst: !!g.planFirst, template: g.id })}>
                <p class="p-studio__goal-title">${g.title}</p>
                <p class="p-studio__goal-text">${g.summary}</p>
              <//>`)}
          </div>
        <//>` : null}
      ${d?.switches?.length ? html`
        <${Section} title="Switched off">
          ${d.switches.map((s) => html`<${Switch} key=${s.id} on=${false} disabled label=${s.label} explain=${s.explain} />`)}
        <//>` : null}
    </div>`;
}
