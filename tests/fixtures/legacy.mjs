// v0.5.3 的提取/精简逻辑，逐字保留作为重构 oracle。
// 只允许测试导入，业务代码禁止引用。
export function legacyExtract(text) {
  const items = [];
  const seen = new Set();
  const collect = (o, depth) => {
    if (!o || typeof o !== "object" || depth > 40) return;
    if (o.aweme_id && o.video && o.video.bit_rate && o.video.bit_rate.length) {
      const id = String(o.aweme_id);
      if (!seen.has(id)) {
        seen.add(id);
        items.push(o);
      }
      return;
    }
    if (o.aweme_detail) {
      collect(o.aweme_detail, depth + 1);
      return;
    }
    for (const k in o) {
      const v = o[k];
      if (v && typeof v === "object") collect(v, depth + 1);
    }
  };
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      collect(JSON.parse(t), 0);
    } catch (e) {}
  }
  try {
    collect(JSON.parse(text), 0);
  } catch (e) {}
  return items;
}

export function legacyNormalizeStreams(video) {
  const out = [];
  const seen = new Set();
  for (const br of (video && video.bit_rate) || []) {
    const pa = br.play_addr || {};
    const urls = pa.url_list || [];
    if (!urls.length) continue;
    const gear = String(br.gear_name || "");
    const m = gear.match(/(\d{3,4})/);
    let label;
    if (m) {
      label = m[1] + "p";
    } else {
      const low = gear.toLowerCase();
      if (low.includes("adapt") || low.includes("pay_") || low.includes("hdr")) continue;
      label = gear || "默认";
    }
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, url: urls[0] });
  }
  if (!out.length) {
    const pa = (video && video.play_addr) || {};
    const ul = pa.url_list || [];
    if (ul.length) out.push({ label: "默认", url: ul[0] });
  }
  return out;
}

export function legacySimplify(items) {
  const list = [];
  for (const c of items) {
    const streams = legacyNormalizeStreams(c.video);
    if (!streams.length) continue;
    list.push({
      aweme_id: String(c.aweme_id),
      title: c.desc || "",
      author: (c.author && c.author.nickname) || "",
      streams,
    });
  }
  return list;
}
