// The map's layout maths (CONTRACTS-V3 29.4): the pinned points, every "must hold" rule over
// generated catalogues, the same answer twice, the keys between hubs, and the real catalogue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAYOUT = join(HERE, "..", "map", "layout.js");
const { layoutOverview, layoutDepartment, neighbours, nearestHub } = await import(pathToFileURL(LAYOUT).href);

// The repo is the first folder above this one that holds engine/company, wherever the tree sits.
function repoRoot() {
  let dir = HERE;
  for (;;) {
    if (existsSync(join(dir, "engine", "company"))) return dir;
    const up = resolve(dir, "..");
    if (up === dir) return null;
    dir = up;
  }
}

const INSET = 16;
const JOB_R = 14;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 0.5, `${what}: ${a} is not ${b}`);

function box(label) {
  const left = label.anchor === "end" ? label.x - label.w : label.anchor === "middle" ? label.x - label.w / 2 : label.x;
  return { left, right: left + label.w, top: label.y - label.h / 2, bottom: label.y + label.h / 2 };
}
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const circleHits = (c, r, b) => {
  const dx = c.x - Math.max(b.left, Math.min(c.x, b.right));
  const dy = c.y - Math.max(b.top, Math.min(c.y, b.bottom));
  return dx * dx + dy * dy < r * r;
};

// ---- Generated catalogues ----

function overviewInput(n, perDept) {
  return {
    departments: Array.from({ length: n }, (_, d) => {
      const clusters = [];
      const per = Array.isArray(perDept) ? perDept[d % perDept.length] : perDept;
      const k = Math.min(3, Math.max(1, per));
      for (let c = 0; c < k; c++) clusters.push({ id: `c${c}`, jobs: [] });
      for (let j = 0; j < per; j++) clusters[j % k].jobs.push(`d${d}-j${j}`);
      return { id: `dept-${d}`, clusters };
    }),
  };
}

function departmentInput(k, per, len) {
  return {
    clusters: Array.from({ length: k }, (_, c) => ({
      id: `cl-${c}`,
      title: `Cluster ${c}`,
      jobs: Array.from({ length: Array.isArray(per) ? per[c % per.length] : per }, (_, j) => ({
        id: `job-${c}-${j}`,
        title: "abcdefghijklmnopqrstuvwxyz0123456789".repeat(2).slice(0, Array.isArray(len) ? len[(c + j) % len.length] : len),
      })),
    })),
  };
}

const OVERVIEW_CASES = [];
for (let n = 1; n <= 9; n++) for (const per of [0, 1, 5, 16]) OVERVIEW_CASES.push(overviewInput(n, per));
for (let n = 1; n <= 9; n++) OVERVIEW_CASES.push(overviewInput(n, [16, 0, 5, 1, 9, 12]));

const DEPARTMENT_CASES = [];
for (let k = 1; k <= 5; k++) for (let per = 1; per <= 8; per++) for (const len of [6, 30, 60]) DEPARTMENT_CASES.push(departmentInput(k, per, len));
for (let k = 1; k <= 5; k++) DEPARTMENT_CASES.push(departmentInput(k, [8, 1, 5, 3, 7], [6, 60, 30, 45, 12]));

// ---- The rules ----

function holdsOverview(input, out) {
  const where = `${input.departments.length} departments`;
  const [, , W, H] = out.viewBox;
  const jobIds = input.departments.flatMap((d) => d.clusters.flatMap((c) => c.jobs.map((j) => (typeof j === "string" ? j : j.id))));
  assert.equal(out.dots.length, jobIds.length, `${where}: one dot per job`);
  assert.deepEqual(out.dots.map((d) => d.id).sort(), jobIds.slice().sort(), `${where}: the dots are the jobs`);
  assert.equal(out.hubs.length, input.departments.length, `${where}: one hub per department`);
  const inside = (x, y, r = 0) => x - r >= INSET && y - r >= INSET && x + r <= W - INSET && y + r <= H - INSET;
  assert.ok(inside(out.brain.x, out.brain.y, out.brain.r), `${where}: the brain is inside`);
  for (const h of out.hubs) {
    assert.ok(inside(h.x, h.y, h.r), `${where}: hub ${h.id} is inside`);
    assert.ok(inside(h.label.x, h.label.y), `${where}: the label of ${h.id} is inside`);
  }
  for (let i = 0; i < out.dots.length; i++) {
    const d = out.dots[i];
    assert.ok(inside(d.x, d.y), `${where}: dot ${d.id} is inside`);
    assert.ok(dist(d, out.brain) >= out.brain.r + 30, `${where}: dot ${d.id} is clear of the brain`);
    for (const h of out.hubs) {
      if (h.id !== d.department) assert.ok(dist(d, h) >= 30, `${where}: dot ${d.id} is clear of hub ${h.id}`);
    }
    for (let k = i + 1; k < out.dots.length; k++) {
      assert.ok(dist(d, out.dots[k]) >= 12, `${where}: dots ${d.id} and ${out.dots[k].id} are ${dist(d, out.dots[k]).toFixed(1)} px apart`);
    }
  }
  for (const l of out.links) assert.ok(out.hubs.some((h) => h.id === l.department && h.x === l.from.x && h.y === l.from.y));
}

function holdsDepartment(input, out) {
  const where = `${input.clusters.length} clusters of ${input.clusters.map((c) => c.jobs.length).join("/")}`;
  const [, , W, H] = out.viewBox;
  const jobIds = input.clusters.flatMap((c) => c.jobs.map((j) => j.id));
  assert.deepEqual(out.jobs.map((j) => j.id).sort(), jobIds.slice().sort(), `${where}: every job once`);
  assert.equal(out.clusters.length, input.clusters.length, `${where}: every cluster once`);
  const inBox = (l, t, r, b) => l >= INSET && t >= INSET && r <= W - INSET && b <= H - INSET;
  assert.ok(inBox(out.hub.x - out.hub.r, out.hub.y - out.hub.r, out.hub.x + out.hub.r, out.hub.y + out.hub.r), `${where}: the hub is inside`);
  for (const c of out.clusters) {
    assert.ok(inBox(c.x, c.y, c.x, c.y), `${where}: cluster ${c.id} is inside`);
    assert.ok(inBox(c.label.x, c.label.y - 8, c.label.x, c.label.y + 8), `${where}: the label of ${c.id} is inside`);
  }
  const boxes = out.jobs.map((j) => box(j.label));
  out.jobs.forEach((j, i) => {
    const title = input.clusters.flatMap((c) => c.jobs).find((x) => x.id === j.id).title;
    near(j.label.w, 7.2 * title.length + 34, `${where}: label width of ${j.id}`);
    assert.equal(j.label.h, 24);
    const b = boxes[i];
    assert.ok(inBox(b.left, b.top, b.right, b.bottom), `${where}: the label of ${j.id} is inside`);
    assert.ok(inBox(j.x - JOB_R, j.y - JOB_R, j.x + JOB_R, j.y + JOB_R), `${where}: the disc of ${j.id} is inside`);
    assert.ok(!circleHits(out.hub, out.hub.r, b), `${where}: the label of ${j.id} is clear of the hub`);
    out.jobs.forEach((o, k) => {
      if (k === i) return;
      if (k > i) assert.ok(!overlap(b, boxes[k]), `${where}: the labels of ${j.id} and ${o.id} overlap`);
      assert.ok(!circleHits(o, JOB_R, b), `${where}: the label of ${j.id} covers the disc of ${o.id}`);
    });
  });
}

// ---- Tests ----

test("the overview's pinned points for 1200 × 760", () => {
  const out = layoutOverview(overviewInput(7, 3));
  assert.deepEqual(out.viewBox, [0, 0, 1200, 760]);
  assert.deepEqual(out.brain, { x: 600, y: 372, r: 46 });
  assert.equal(out.hubs.length, 7);
  assert.equal(out.hubs[0].x, 600);
  assert.equal(out.hubs[0].y, 157);
  assert.equal(out.hubs[0].r, 20);
  assert.equal(out.hubs[1].x, 834.5);
  assert.equal(out.hubs[1].y, 238);
  near(out.hubs[1].angle, -90 + 360 / 7, "hub 1's angle");
  assert.equal(out.hubs[0].label.anchor, "middle");
  near(out.hubs[0].label.y, 372 - 300, "hub 0's label");
  assert.equal(out.hubs[1].label.anchor, "start");
  assert.equal(out.hubs[6].label.anchor, "end");
});

test("the overview's dots sit on the arcs, within 56° of the outward ray, inner arc first", () => {
  const out = layoutOverview(overviewInput(7, 16));
  for (const h of out.hubs) {
    const mine = out.dots.filter((d) => d.department === h.id);
    assert.equal(mine.length, 16);
    const radii = mine.map((d) => dist(d, h));
    for (const r of radii) assert.ok([46, 70, 94].some((a) => Math.abs(a - r) <= 1), `radius ${r}`);
    for (let i = 1; i < radii.length; i++) assert.ok(radii[i] >= radii[i - 1] - 1, "inner arc first");
    for (const d of mine) {
      const a = (Math.atan2(d.y - h.y, d.x - h.x) * 180) / Math.PI;
      const off = Math.abs(((a - h.angle + 540) % 360) - 180);
      assert.ok(off <= 56.5, `${d.id} is ${off.toFixed(1)}° off its hub's ray`);
    }
  }
});

test("the overview keeps a hub's dots together by cluster, in file order", () => {
  const out = layoutOverview(overviewInput(1, 5));
  assert.deepEqual(out.dots.map((d) => d.cluster), ["c0", "c0", "c1", "c1", "c2"]);
  assert.equal(out.links.length, 5);
});

test("the overview holds every rule for 1 to 9 departments with 0, 1, 5 and 16 jobs", () => {
  for (const input of OVERVIEW_CASES) holdsOverview(input, layoutOverview(input));
});

test("the overview gives the same answer for the same catalogue", () => {
  for (const input of OVERVIEW_CASES) assert.deepEqual(layoutOverview(input), layoutOverview(structuredClone(input)));
});

test("the overview copes with nothing", () => {
  const out = layoutOverview({ departments: [] });
  assert.deepEqual(out.hubs, []);
  assert.deepEqual(out.dots, []);
  assert.equal(layoutOverview().brain.x, 600);
});

test("the department's pinned points: the hub, the fan of clusters and the label box", () => {
  const out = layoutDepartment(departmentInput(3, 2, 13));
  assert.deepEqual(out.viewBox, [0, 0, 1200, 760]);
  assert.deepEqual(out.hub, { x: 600, y: 640, r: 28 });
  const angles = out.clusters.map((c) => (Math.atan2(c.y - 640, c.x - 600) * 180) / Math.PI + 360);
  [200, 270, 340].forEach((a, i) => near(angles[i], a, `cluster ${i}'s angle`));
  for (const c of out.clusters) near(dist(c, out.hub), 300, "cluster radius");
  for (const j of out.jobs) {
    near(j.label.w, 7.2 * 13 + 34, "label width");
    assert.equal(j.label.h, 24);
    assert.ok(j.y < out.hub.y, "the jobs fan upward");
  }
  const one = layoutDepartment(departmentInput(1, 1, 6));
  assert.equal(one.clusters[0].x, 600);
  assert.equal(one.clusters[0].y, 340);
});

test("the department joins its hub to each cluster and each cluster to its jobs", () => {
  const input = departmentInput(4, 3, 20);
  const out = layoutDepartment(input);
  assert.equal(out.links.length, 4 + 12);
  for (const j of out.jobs) {
    const c = out.clusters.find((x) => x.id === j.cluster);
    assert.ok(out.links.some((l) => l.from.x === c.x && l.from.y === c.y && l.to.x === j.x && l.to.y === j.y));
  }
});

test("the department holds every rule for 1 to 5 clusters of 1 to 8 jobs, titles of 6, 30 and 60 characters", () => {
  for (const input of DEPARTMENT_CASES) holdsDepartment(input, layoutDepartment(input));
});

test("the department gives the same answer for the same catalogue", () => {
  for (const input of DEPARTMENT_CASES) assert.deepEqual(layoutDepartment(input), layoutDepartment(structuredClone(input)));
});

test("a cluster with no jobs still has its place", () => {
  const out = layoutDepartment({ clusters: [{ id: "a", title: "A", jobs: [] }, { id: "b", title: "B", jobs: [{ id: "x", title: "Job" }] }] });
  assert.deepEqual(out.clusters.map((c) => c.id), ["a", "b"]);
  assert.equal(out.jobs.length, 1);
});

test("neighbours wraps around", () => {
  const ids = ["operations", "sales", "books"];
  assert.deepEqual(neighbours(ids, "operations"), { prev: "books", next: "sales" });
  assert.deepEqual(neighbours(ids, "books"), { prev: "sales", next: "operations" });
  assert.deepEqual(neighbours(ids, "sales"), { prev: "operations", next: "books" });
  assert.deepEqual(neighbours(["one"], "one"), { prev: "one", next: "one" });
  assert.deepEqual(neighbours(ids, "nowhere"), { prev: null, next: null });
});

test("nearestHub: right and down go clockwise, left and up the other way", () => {
  const { hubs } = layoutOverview(overviewInput(7, 0));
  assert.equal(nearestHub(hubs, "dept-0", "ArrowRight"), "dept-1");
  assert.equal(nearestHub(hubs, "dept-0", "ArrowDown"), "dept-1");
  assert.equal(nearestHub(hubs, "dept-0", "ArrowLeft"), "dept-6");
  assert.equal(nearestHub(hubs, "dept-0", "ArrowUp"), "dept-6");
  assert.equal(nearestHub(hubs, "dept-6", "ArrowRight"), "dept-0");
  assert.equal(nearestHub(hubs, "dept-3", "Enter"), "dept-3");
  assert.equal(nearestHub(["a", "b"], "b", "ArrowDown"), "a");
  assert.equal(nearestHub([], "a", "ArrowDown"), null);
});

test("the layout module is pure: no page, no randomness, no imports", () => {
  const src = readFileSync(LAYOUT, "utf8");
  assert.doesNotMatch(src, /document|window|Math\.random|^import /m);
});

// ---- The real catalogue ----

function realCatalogue() {
  const root = repoRoot();
  if (!root) return null;
  const file = join(root, "engine", "company", "departments.json");
  const jobsDir = join(root, "engine", "company", "jobs");
  if (!existsSync(file) || !existsSync(jobsDir)) return null;
  const departments = JSON.parse(readFileSync(file, "utf8")).departments;
  return departments.map((d) => {
    const folder = join(jobsDir, d.id);
    const jobs = existsSync(folder)
      ? readdirSync(folder)
          .filter((f) => f.endsWith(".json"))
          .sort()
          .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")))
      : [];
    return {
      id: d.id,
      clusters: d.clusters.map((c) => ({
        id: c.id,
        title: c.title,
        jobs: jobs.filter((j) => j.cluster === c.id).map((j) => ({ id: j.id, title: String(j.title) })),
      })),
    };
  });
}

const REAL = realCatalogue();

test("the real catalogue holds the same rules", { skip: REAL ? false : "departments.json and the job files are not written yet" }, () => {
  const overview = { departments: REAL.map((d) => ({ id: d.id, clusters: d.clusters.map((c) => ({ id: c.id, jobs: c.jobs.map((j) => j.id) })) })) };
  const out = layoutOverview(overview);
  holdsOverview(overview, out);
  assert.deepEqual(out, layoutOverview(structuredClone(overview)));
  for (const d of REAL) {
    const input = { clusters: d.clusters };
    const view = layoutDepartment(input);
    holdsDepartment(input, view);
    assert.deepEqual(view, layoutDepartment(structuredClone(input)));
  }
});
