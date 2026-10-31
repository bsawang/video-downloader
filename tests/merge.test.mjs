import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFmp4Blobs, parseBoxes, findBox } from "../src/kernel/merge.js";

function u32(v) {
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

function box(type, payload) {
  const body = Uint8Array.from(payload);
  const out = new Uint8Array(8 + body.length);
  const size = out.length;
  out[0] = (size >>> 24) & 255;
  out[1] = (size >>> 16) & 255;
  out[2] = (size >>> 8) & 255;
  out[3] = size & 255;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out;
}

function cat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

function fullBox(type, version, flags, body) {
  return box(type, cat(Uint8Array.from([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), body));
}

function tkhd(trackId) {
  // v0: version/flags(4) + creation(4) + modification(4) + track_ID(4) + 其余
  return fullBox("tkhd", 0, 3, cat(Uint8Array.from([...u32(0), ...u32(0), ...u32(trackId)]), new Uint8Array(60)));
}

function mvhd(nextTrackId) {
  return fullBox("mvhd", 0, 0, cat(new Uint8Array(96), Uint8Array.from(u32(nextTrackId))));
}

function trex(trackId) {
  return fullBox("trex", 0, 0, cat(Uint8Array.from(u32(trackId)), new Uint8Array(12)));
}

function trak(trackId) {
  return box("trak", tkhd(trackId));
}

function moov(trackId, { withMvex = true } = {}) {
  return box("moov", cat(mvhd(2), trak(trackId), ...(withMvex ? [box("mvex", trex(trackId))] : [])));
}

function moof(trackId) {
  const tfhd = fullBox("tfhd", 0, 0, cat(Uint8Array.from(u32(trackId)), new Uint8Array(8)));
  const mfhd = fullBox("mfhd", 0, 0, Uint8Array.from(u32(1)));
  return box("moof", cat(mfhd, box("traf", tfhd)));
}

function mdat(bytes) {
  return box("mdat", Uint8Array.from(bytes));
}

const FTYP = box("ftyp", Uint8Array.from([...new TextEncoder().encode("isom"), 0, 0, 0, 0, ...new TextEncoder().encode("isom")]));

function videoFile({ withMvex = true } = {}) {
  return cat(
    FTYP,
    moov(1, { withMvex }),
    box("sidx", new Uint8Array(20)),
    moof(1),
    mdat([1, 2, 3]),
    moof(1),
    mdat([4, 5])
  );
}

function audioFile() {
  return cat(
    FTYP,
    moov(1),
    box("sidx", new Uint8Array(12)),
    moof(1),
    mdat([9, 9]),
    moof(1),
    mdat([8])
  );
}

function sink() {
  const chunks = [];
  return {
    chunks,
    async write(chunk) {
      chunks.push(new Uint8Array(chunk));
    },
    bytes() {
      return cat(...chunks);
    },
  };
}

function trackIdsOf(bytes, moovBox) {
  const children = parseBoxes(bytes, moovBox.start + moovBox.headerSize, moovBox.end);
  return children
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const tk = findBox(bytes, trak.start + trak.headerSize, trak.end, "tkhd");
      const p = tk.start + tk.headerSize;
      const off = bytes[p] === 1 ? 4 + 8 + 8 : 4 + 4 + 4;
      return (bytes[p + off] << 24) + (bytes[p + off + 1] << 16) + (bytes[p + off + 2] << 8) + bytes[p + off + 3];
    });
}

function trackIdOfBox(bytes, boxBox) {
  const p = boxBox.start + boxBox.headerSize + 4;
  return (bytes[p] << 24) + (bytes[p + 1] << 16) + (bytes[p + 2] << 8) + bytes[p + 3];
}

test("mergeFmp4Blobs 合成单 moov 双 trak，音频 track id 改为 2", async () => {
  const out = sink();
  const progress = [];
  const result = await mergeFmp4Blobs(new Blob([videoFile()]), new Blob([audioFile()]), out, (p) => progress.push(p));
  const bytes = out.bytes();
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1), 100);

  const top = parseBoxes(bytes);
  assert.deepEqual(top.map((b) => b.type), ["ftyp", "moov", "moof", "mdat", "moof", "mdat", "moof", "mdat", "moof", "mdat"]);
  const moovBox = top.find((b) => b.type === "moov");
  const children = parseBoxes(bytes, moovBox.start + moovBox.headerSize, moovBox.end);
  assert.deepEqual(children.map((b) => b.type), ["mvhd", "trak", "trak", "mvex"]);
  assert.deepEqual(trackIdsOf(bytes, moovBox), [1, 2]);

  const mvex = children.find((b) => b.type === "mvex");
  const trexes = parseBoxes(bytes, mvex.start + mvex.headerSize, mvex.end).filter((b) => b.type === "trex");
  assert.deepEqual(trexes.map((b) => trackIdOfBox(bytes, b)), [1, 2]);

  const moofs = top.filter((b) => b.type === "moof");
  assert.deepEqual(
    moofs.map((moofBox) => {
      const traf = findBox(bytes, moofBox.start + moofBox.headerSize, moofBox.end, "traf");
      const tfhd = findBox(bytes, traf.start + traf.headerSize, traf.end, "tfhd");
      return trackIdOfBox(bytes, tfhd);
    }),
    [1, 1, 2, 2]
  );

  const mvhd = children.find((b) => b.type === "mvhd");
  assert.deepEqual([...bytes.slice(mvhd.end - 4, mvhd.end)], [0, 0, 0, 3]);

  const mediaBytes =
    (videoFile().length - FTYP.length - moov(1).length - 28) +
    (audioFile().length - FTYP.length - moov(1).length - 20);
  assert.equal(bytes.length, result.headerBytes + mediaBytes);
  assert.equal(result.bytes, bytes.length);
});

test("mergeFmp4Blobs 丢弃 sidx，媒体顺序为视频段后音频段", async () => {
  const out = sink();
  await mergeFmp4Blobs(new Blob([videoFile()]), new Blob([audioFile()]), out);
  const bytes = out.bytes();
  const top = parseBoxes(bytes);
  assert.equal(top.some((b) => b.type === "sidx"), false);
  const mdats = top.filter((b) => b.type === "mdat").map((b) => [...bytes.slice(b.start + b.headerSize, b.end)]);
  assert.deepEqual(mdats, [[1, 2, 3], [4, 5], [9, 9], [8]]);
});

test("mergeFmp4Blobs 拒绝非分片 MP4（moov 无 mvex）", async () => {
  await assert.rejects(
    () => mergeFmp4Blobs(new Blob([videoFile({ withMvex: false })]), new Blob([audioFile()]), sink()),
    /不是分片 MP4/
  );
});

test("mergeFmp4Blobs 拒绝媒体段没有 moof", async () => {
  const video = cat(FTYP, moov(1), mdat([1, 2, 3]));
  await assert.rejects(() => mergeFmp4Blobs(new Blob([video]), new Blob([audioFile()]), sink()), /不是分片 MP4/);
});

test("mergeFmp4Blobs 拒绝截断的 box", async () => {
  const broken = videoFile().slice(0, videoFile().length - 3);
  await assert.rejects(() => mergeFmp4Blobs(new Blob([broken]), new Blob([audioFile()]), sink()), /文件不完整/);
});

test("mergeFmp4Blobs 支持 Blob 分块读取大 mdat", async () => {
  const big = new Uint8Array(200 * 1024).fill(7);
  const video = cat(FTYP, moov(1), moof(1), mdat(big));
  const out = sink();
  await mergeFmp4Blobs(new Blob([video]), new Blob([audioFile()]), out);
  const bytes = out.bytes();
  assert.ok(out.chunks.length > 1, "mdat 应分块写入");
  const mdatBox = parseBoxes(bytes).find((b) => b.type === "mdat");
  assert.equal(mdatBox.end - mdatBox.start - mdatBox.headerSize, big.length);
});
