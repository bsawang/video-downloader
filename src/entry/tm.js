import { start } from "../kernel/core.js";
import { douyinAdapter } from "../platforms/douyin/adapter.js";
import { bilibiliAdapter } from "../platforms/bilibili/adapter.js";
import { xiaohongshuAdapter } from "../platforms/xiaohongshu/adapter.js";
import { youtubeAdapter } from "../platforms/youtube/adapter.js";

// @match 只是让脚本在站点上跑起来，具体用哪份适配由这里按 matches 选。
function matchAdapterUrl(pattern, url) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + escaped + "$").test(url);
}

const ADAPTERS = [douyinAdapter, bilibiliAdapter, xiaohongshuAdapter, youtubeAdapter];
const adapter = ADAPTERS.find((a) => a.matches.some((m) => matchAdapterUrl(m, location.href)));
if (adapter) start(adapter);
