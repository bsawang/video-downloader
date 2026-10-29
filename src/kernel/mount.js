function extractId(el, spec) {
  if (typeof spec === "function") return spec(el);
  switch (spec.type) {
    case "attr":
      return el.getAttribute(spec.name);
    case "idPrefix":
      return el.id && el.id.startsWith(spec.prefix) ? el.id.slice(spec.prefix.length) : null;
    case "className": {
      const m = String(el.className || "").match(spec.pattern);
      return m ? m[1] : null;
    }
    case "mediaSrc": {
      const src = el.currentSrc || el.src || "";
      const m = src.match(spec.pattern);
      return m ? m[1] : null;
    }
    case "innerHref": {
      const a = el.querySelector(spec.selector);
      if (!a) return null;
      const m = String(a.getAttribute("href") || "").match(spec.pattern);
      return m ? m[1] : null;
    }
    default:
      return null;
  }
}

export function scan(rules, root = document) {
  const found = [];
  const seen = new Set();
  for (const rule of rules) {
    if (rule.pageScope && !rule.pageScope.test(location.pathname)) continue;
    let els;
    try {
      els = root.querySelectorAll(rule.selector);
    } catch (e) {
      continue;
    }
    for (const el of els) {
      const id = extractId(el, rule.idFrom);
      if (!id) continue;
      const target = rule.resolve ? rule.resolve(el) : el;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      found.push({ el: target, videoId: String(id), rule });
    }
  }
  return found;
}

export function pickAnchor(el, mounts) {
  for (let i = 0; i < mounts.length; i++) {
    const m = mounts[i];
    const cand = m === "self" ? el : el.querySelector(m);
    if (!cand) continue;
    const positional = getComputedStyle(cand).position !== "static";
    if (i === 0) return cand;
    if (positional) return cand;
  }
  return null;
}
