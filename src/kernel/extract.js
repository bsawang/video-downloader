// 通用提取：无任何平台字符串。
export function parseLooseJSON(text) {
  if (typeof text !== "string" || !text) return [];
  const out = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch (e) {}
  }
  try {
    out.push(JSON.parse(text));
  } catch (e) {}
  return out;
}

export function deepFind(root, predicate, maxDepth = 40) {
  const found = [];
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || depth > maxDepth || seen.has(o)) return;
    seen.add(o);
    if (predicate(o)) {
      found.push(o);
      return;
    }
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}

export function normalizeQuality(gearName, mapping = {}) {
  const gear = String(gearName || "");
  if (Object.prototype.hasOwnProperty.call(mapping, gear)) return mapping[gear];
  const m = gear.match(/(\d{3,4})/);
  if (m) return m[1] + "p";
  const low = gear.toLowerCase();
  if (low.includes("adapt") || low.includes("pay_") || low.includes("hdr")) return null;
  return gear || "默认";
}

export function qualityRank(label) {
  const m = String(label || "").match(/(\d{3,4})/);
  return m ? Number(m[1]) : -1;
}

export function sortStreams(streams) {
  return [...(streams || [])].sort((a, b) => qualityRank(b.label) - qualityRank(a.label));
}

export function sanitizeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").trim();
}

export function collect(text, source, adapter) {
  const out = [];
  const seen = new Set();
  for (const obj of source.extract(text)) {
    for (const raw of deepFind(obj, adapter.isVideo)) {
      const item = adapter.parse(raw);
      if (item && !seen.has(item.videoId)) {
        seen.add(item.videoId);
        out.push(item);
      }
    }
  }
  return out;
}
