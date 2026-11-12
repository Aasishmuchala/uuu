// A zip of a built site for the owner's export (PLAN-V5 K15). Written from a file list the
// caller has already read and checked (collectSite); the names are checked again here, so
// a zip never holds a name the viewer would not serve. Deflate through zlib, CRC-32 through
// zlib. No zip64: the site's limits keep every size far below 4 GB. Zero dependencies.
import { crc32, deflateRawSync } from "node:zlib";
import { checkEntries } from "./sitefiles.mjs";

// A DOS date and time (local clock, as zip tools read it).
function dosTime(ms) {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// files: [{ name, data }] -> the bytes of a zip. Throws when the list breaks the site rules.
export function writeZip(files, { now = Date.now() } = {}) {
  if (!Array.isArray(files)) throw new Error("writeZip: files must be a list");
  const check = checkEntries(files.map((f) => ({ name: f && f.name, type: "file", size: f && Buffer.isBuffer(f.data) ? f.data.length : -1 })));
  if (!check.ok) throw new Error(`writeZip: ${check.reason}`);
  const { time, date } = dosTime(now);
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data, { level: 6 });
    const stored = packed.length >= f.data.length;
    const body = stored ? f.data : packed;
    const crc = crc32(f.data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);                 // version needed
    lh.writeUInt16LE(0x0800, 6);             // names are UTF-8
    lh.writeUInt16LE(stored ? 0 : 8, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(0x0314, 4);             // made by: Unix, 2.0
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(stored ? 0 : 8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
