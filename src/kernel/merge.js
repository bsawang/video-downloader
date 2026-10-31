// 零依赖 fMP4（ISO BMFF）分片合并：把两路「分片 MP4」拼成一个单 moov 双 trak 的文件。
// 只搬箱，不碰编码；遇到非分片 MP4 / WebM 直接拒绝，由调用方回退拆分下载。

const HEAD_START = 1024 * 1024;
const HEAD_MAX = 32 * 1024 * 1024;
const SKIP_IN_MEDIA = new Set(["sidx", "ssix", "mfra", "ftyp", "moov"]);

function u32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function putU32(b, o, v) {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
}

function fourcc(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function readBox(bytes, offset, end) {
  if (offset + 8 > end) return null;
  let size = u32(bytes, offset);
  const type = fourcc(bytes, offset + 4);
  let headerSize = 8;
  let boxEnd;
  if (size === 1) {
    if (offset + 16 > end) return null;
    size = u32(bytes, offset + 8) * 4294967296 + u32(bytes, offset + 12);
    headerSize = 16;
    boxEnd = offset + size;
  } else if (size === 0) {
    boxEnd = end;
  } else if (size >= 8) {
    boxEnd = offset + size;
  } else {
    return null;
  }
  if (boxEnd > end || boxEnd < offset + headerSize) return null;
  return { type, start: offset, end: boxEnd, headerSize };
}

export function parseBoxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  let pos = start;
  while (pos + 8 <= end) {
    const box = readBox(bytes, pos, end);
    if (!box) break;
    out.push(box);
    if (box.end <= pos) break;
    pos = box.end;
  }
  return out;
}

export function findBox(bytes, start, end, type) {
  return parseBoxes(bytes, start, end).find((b) => b.type === type) || null;
}

function concatBytes(list) {
  let total = 0;
  for (const part of list) total += part.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of list) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

function makeBox(type, payload) {
  const out = new Uint8Array(8 + payload.length);
  putU32(out, 0, out.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  return out;
}

function payloadStart(bytes, box) {
  return box.start + box.headerSize;
}

// tkhd 的 track_ID 在 version/flags + creation + modification 之后：
// v0 两个时间字段各 4 字节，v1 各 8 字节
function patchTkhd(bytes, box, id) {
  const p = payloadStart(bytes, box);
  const version = bytes[p];
  const at = p + (version === 1 ? 4 + 8 + 8 : 4 + 4 + 4);
  if (at + 4 > box.end) throw new Error("文件不完整：tkhd 越界");
  putU32(bytes, at, id);
}

// trex / tfhd：version/flags(4) + track_ID(4)
function patchTrackIdBox(bytes, box, id) {
  const at = payloadStart(bytes, box) + 4;
  if (at + 4 > box.end) throw new Error("文件不完整：track id 越界");
  putU32(bytes, at, id);
}

function moovTrakIds(bytes, moov) {
  const children = parseBoxes(bytes, payloadStart(bytes, moov), moov.end);
  return children
    .filter((b) => b.type === "trak")
    .map((trak) => {
      const tkhd = findBox(bytes, payloadStart(bytes, trak), trak.end, "tkhd");
      if (!tkhd) throw new Error("该流不是分片 MP4，暂不支持合并");
      const p = payloadStart(bytes, tkhd);
      const at = p + (bytes[p] === 1 ? 4 + 8 + 8 : 4 + 4 + 4);
      return u32(bytes, at);
    });
}

function patchMvhd(bytes, mvhd, nextTrackId) {
  putU32(bytes, mvhd.end - 4, nextTrackId);
}

function patchMoofTrackId(bytes, moof, id) {
  const moofChildren = parseBoxes(bytes, payloadStart(bytes, moof), moof.end);
  for (const child of moofChildren) {
    if (child.type !== "traf") continue;
    const trafChildren = parseBoxes(bytes, payloadStart(bytes, child), child.end);
    for (const c of trafChildren) {
      if (c.type === "tfhd") patchTrackIdBox(bytes, c, id);
    }
  }
}

function buildMergedMoov(vInit, aInit, newAudioId) {
  const vBytes = vInit.bytes;
  const aBytes = aInit.bytes;
  const vChildren = parseBoxes(vBytes, payloadStart(vBytes, vInit.moov), vInit.moov.end);
  const aChildren = parseBoxes(aBytes, payloadStart(aBytes, aInit.moov), aInit.moov.end);
  const aTrak = aChildren.find((b) => b.type === "trak");
  const aMvex = aChildren.find((b) => b.type === "mvex");
  const vMvex = vChildren.find((b) => b.type === "mvex");
  if (!aTrak || !aMvex || !vMvex) throw new Error("该流不是分片 MP4，暂不支持合并");

  const aTrakBytes = aBytes.slice(aTrak.start, aTrak.end);
  const aTrakBox = readBox(aTrakBytes, 0, aTrakBytes.length);
  const aTkhd = findBox(aTrakBytes, payloadStart(aTrakBytes, aTrakBox), aTrakBox.end, "tkhd");
  if (!aTkhd) throw new Error("该流不是分片 MP4，暂不支持合并");
  patchTkhd(aTrakBytes, aTkhd, newAudioId);

  const aTrexes = parseBoxes(aBytes, payloadStart(aBytes, aMvex), aMvex.end)
    .filter((b) => b.type === "trex")
    .map((trex) => {
      const copy = aBytes.slice(trex.start, trex.end);
      patchTrackIdBox(copy, readBox(copy, 0, copy.length), newAudioId);
      return copy;
    });
  if (!aTrexes.length) throw new Error("该流不是分片 MP4，暂不支持合并");

  const vMvexChildren = parseBoxes(vBytes, payloadStart(vBytes, vMvex), vMvex.end).map((b) =>
    vBytes.slice(b.start, b.end)
  );
  const mergedMvex = makeBox("mvex", concatBytes([...vMvexChildren, ...aTrexes]));

  const parts = [];
  let trakInserted = false;
  for (const child of vChildren) {
    if (child.type === "mvhd") {
      const copy = vBytes.slice(child.start, child.end);
      patchMvhd(copy, readBox(copy, 0, copy.length), newAudioId + 1);
      parts.push(copy);
    } else if (child.type === "mvex") {
      parts.push(mergedMvex);
    } else {
      parts.push(vBytes.slice(child.start, child.end));
    }
    if (child.type === "trak" && !trakInserted) {
      parts.push(aTrakBytes);
      trakInserted = true;
    }
  }
  if (!trakInserted) parts.push(aTrakBytes);
  return makeBox("moov", concatBytes(parts));
}

async function readHead(blob) {
  let len = Math.min(blob.size, HEAD_START);
  for (;;) {
    const bytes = new Uint8Array(await blob.slice(0, len).arrayBuffer());
    const boxes = parseBoxes(bytes, 0, bytes.length);
    const moov = boxes.find((b) => b.type === "moov");
    if (moov) {
      const ftyp = boxes.find((b) => b.type === "ftyp");
      const initEnd = Math.max(moov.end, ftyp ? ftyp.end : 0);
      return { bytes, moov, ftyp, initEnd };
    }
    if (len >= blob.size || len >= HEAD_MAX) throw new Error("文件不完整：找不到 moov");
    len = Math.min(blob.size, Math.min(len * 2, HEAD_MAX));
  }
}

function readBoxHeader(header, fileSize, pos) {
  if (header.length < 8) throw new Error("文件不完整：box 头被截断");
  let size = u32(header, 0);
  let headerSize = 8;
  if (size === 1) {
    if (header.length < 16) throw new Error("文件不完整：box 头被截断");
    size = u32(header, 8) * 4294967296 + u32(header, 12);
    headerSize = 16;
  } else if (size === 0) {
    size = fileSize - pos;
  }
  const type = fourcc(header, 4);
  if (size < headerSize || pos + size > fileSize) {
    throw new Error("文件不完整：box 长度越界（" + type + "）");
  }
  return { type, size, headerSize };
}

async function listMediaBoxes(blob, start) {
  const out = [];
  let pos = start;
  while (pos < blob.size) {
    const head = new Uint8Array(await blob.slice(pos, Math.min(pos + 16, blob.size)).arrayBuffer());
    const h = readBoxHeader(head, blob.size, pos);
    out.push({ type: h.type, start: pos, end: pos + h.size, headerSize: h.headerSize });
    pos += h.size;
  }
  return out;
}

async function copyRange(blob, start, end, sink, onBytes) {
  for await (const chunk of blob.slice(start, end).stream()) {
    await sink.write(chunk);
    onBytes(chunk.length);
  }
}

export async function mergeFmp4Blobs(videoBlob, audioBlob, sink, onProgress) {
  const vInit = await readHead(videoBlob);
  const aInit = await readHead(audioBlob);
  const vIds = moovTrakIds(vInit.bytes, vInit.moov);
  const aIds = moovTrakIds(aInit.bytes, aInit.moov);
  if (vIds.length !== 1 || aIds.length !== 1) {
    throw new Error("该流不是分片 MP4，暂不支持合并");
  }
  const newAudioId = Math.max(...vIds) + 1;
  const mergedMoov = buildMergedMoov(vInit, aInit, newAudioId);
  const ftyp = vInit.ftyp ? vInit.bytes.slice(vInit.ftyp.start, vInit.ftyp.end) : makeBox("ftyp", new Uint8Array(0));
  const header = concatBytes([ftyp, mergedMoov]);

  const vBoxes = await listMediaBoxes(videoBlob, vInit.initEnd);
  const aBoxes = await listMediaBoxes(audioBlob, aInit.initEnd);
  if (!vBoxes.some((b) => b.type === "moof") || !aBoxes.some((b) => b.type === "moof")) {
    throw new Error("该流不是分片 MP4，暂不支持合并");
  }
  const outputBytes = vBoxes
    .filter((b) => !SKIP_IN_MEDIA.has(b.type))
    .reduce((n, b) => n + (b.end - b.start), 0) +
    aBoxes.filter((b) => !SKIP_IN_MEDIA.has(b.type)).reduce((n, b) => n + (b.end - b.start), 0);
  const total = header.length + outputBytes;

  await sink.write(header);
  let written = header.length;
  let lastAt = 0;
  const onBytes = (n) => {
    written += n;
    const now = Date.now();
    if (onProgress && (now - lastAt > 250 || written >= total)) {
      lastAt = now;
      onProgress(Math.min(100, Math.round((written / total) * 100)));
    }
  };

  for (const box of vBoxes) {
    if (SKIP_IN_MEDIA.has(box.type)) continue;
    if (box.type === "moof") {
      const buf = new Uint8Array(await videoBlob.slice(box.start, box.end).arrayBuffer());
      await sink.write(buf);
      onBytes(buf.length);
    } else {
      await copyRange(videoBlob, box.start, box.end, sink, onBytes);
    }
  }
  for (const box of aBoxes) {
    if (SKIP_IN_MEDIA.has(box.type)) continue;
    if (box.type === "moof") {
      const buf = new Uint8Array(await audioBlob.slice(box.start, box.end).arrayBuffer());
      const moof = readBox(buf, 0, buf.length);
      patchMoofTrackId(buf, moof, newAudioId);
      await sink.write(buf);
      onBytes(buf.length);
    } else {
      await copyRange(audioBlob, box.start, box.end, sink, onBytes);
    }
  }
  return { bytes: written, headerBytes: header.length, videoBytes: videoBlob.size, audioBytes: audioBlob.size };
}
