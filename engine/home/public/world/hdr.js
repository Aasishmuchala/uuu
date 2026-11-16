// Radiance .hdr (RGBE) decoder for the sky's light: flat and new-style run-length rows. Returns linear float RGB.
// Ported from the approved prototype (cook/proto/engine/js/hdr.js); the writer it also held is not needed here.
// Every read is bounded by the buffer, so a short or damaged file throws instead of reading past its end.
export function decodeHDR(buf) {
  const u8 = new Uint8Array(buf);
  let p = 0;
  const line = () => {
    let s = "";
    while (p < u8.length && u8[p] !== 10 && s.length < 256) s += String.fromCharCode(u8[p++]);
    p++;
    return s;
  };
  if (!line().startsWith("#?")) throw new Error("not a Radiance file");
  let fmtOK = false;
  for (;;) {
    const l = line();
    if (l === "") break;
    if (l.startsWith("FORMAT=32-bit_rle_rgbe")) fmtOK = true;
    if (p >= u8.length) throw new Error("bad header");
  }
  if (!fmtOK) throw new Error("unsupported hdr format");
  const m = line().match(/^-Y (\d+) \+X (\d+)$/);
  if (!m) throw new Error("unsupported hdr orientation");
  const H = +m[1], W = +m[2];
  if (!(W > 0 && H > 0 && W <= 8192 && H <= 8192)) throw new Error("bad hdr size");
  const rgbe = new Uint8Array(W * H * 4);
  const row = new Uint8Array(W * 4);
  const need = (n) => { if (p + n > u8.length) throw new Error("short hdr"); };
  for (let y = 0; y < H; y++) {
    need(4);
    if (W >= 8 && W < 32768 && u8[p] === 2 && u8[p + 1] === 2 && !(u8[p + 2] & 128)) {
      // run-length: four planes, one after another
      if (((u8[p + 2] << 8) | u8[p + 3]) !== W) throw new Error("bad scanline width");
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          need(1);
          let n = u8[p++];
          if (n > 128) {
            n -= 128;
            need(1);
            if (x + n > W) throw new Error("bad run");
            const v = u8[p++];
            while (n--) row[(x++) * 4 + c] = v;
          } else {
            if (n === 0 || x + n > W) throw new Error("bad run");
            need(n);
            while (n--) row[(x++) * 4 + c] = u8[p++];
          }
        }
      }
      rgbe.set(row, y * W * 4);
    } else {
      need(W * 4);
      rgbe.set(u8.subarray(p, p + W * 4), y * W * 4);
      p += W * 4;
    }
  }
  const f = new Float32Array(W * H * 3);
  for (let i = 0, j = 0; i < rgbe.length; i += 4, j += 3) {
    const e = rgbe[i + 3];
    if (e) { const s = Math.pow(2, e - 136); f[j] = rgbe[i] * s; f[j + 1] = rgbe[i + 1] * s; f[j + 2] = rgbe[i + 2] * s; }
  }
  return { width: W, height: H, data: f };
}
