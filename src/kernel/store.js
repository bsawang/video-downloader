// 候选仓库：后到覆盖（与 v0.5.3 Map.set 等价），仅供页面内使用。
export function createStore() {
  const map = new Map();
  const listeners = new Set();

  function upsert(item) {
    if (!item || !item.videoId) return null;
    map.set(item.videoId, item);
    for (const cb of listeners) cb(item);
    return item;
  }

  return {
    upsert,
    get: (videoId) => map.get(videoId),
    entries: () => [...map.values()],
    get size() {
      return map.size;
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
