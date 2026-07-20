// ==UserScript==
// @name         Bilibili 自动点赞 - 最新视频循环版
// @namespace    BilibiliAutoLike
// @match        *://*.bilibili.com/*
// @noframes
// @version      1.0.2
// @author       fuxing
// @description  浏览器开启时全自动循环检测刚发布的B站视频并“秒赞”，高频轮询最新页+发现即点赞+极短冷却，按B站规则控制频率(每小时上限+风控退避)，WBI签名全本地自动完成，无需人工干预。
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @run-at       document-end
// ==/UserScript==

"use strict";

/* ============================================================
 * 使用前提：需保持至少一个 bilibili.com 标签页打开（后台标签页亦可）。
 * 脚本随浏览器登录态自动运行，无需任何手动操作。
 * ============================================================ */

// ---------- 可调参数 ----------
const KEYWORDS = ["生活", "日常", "vlog", "游戏", "科技", "音乐", "美食", "搞笑"]; // 轮换搜索关键词（覆盖分区越广，秒赞命中面越大）
const CHECK_INTERVAL_BASE = 15;         // 检测间隔基准(秒)：高频轮询最新页，贴近“秒赞”效果
const CHECK_INTERVAL_MIN = 10;          // 检测间隔下限(秒)
const CHECK_INTERVAL_MAX = 60;          // 检测间隔上限(秒)：仅作兜底(接近上限时由窗口逻辑睡到下一窗口)
const NO_HIT_POLL_MS = 5000;            // 本轮无新视频时的短轮询间隔(毫秒)：快速换词继续刷，直到真正点赞才拉长
const CYCLE_LIKE_COOLDOWN_MIN = 1;      // 同轮内连续点赞的极短冷却(秒)，秒赞仍近乎瞬时
const CYCLE_LIKE_COOLDOWN_MAX = 2;
const FRESH_WINDOW_MIN = 3;              // 基础新鲜度窗口(分钟)：只“秒赞”发布于最近 N 分钟内的视频
const FRESH_WINDOW_MAX = 30;             // 新鲜度窗口放宽上限(分钟)：多次刷不到时自动放宽，但不超过此值
const FRESH_WINDOW_WIDEN_STEP = 3;       // 每次放宽增加的分钟数
const NO_HIT_WIDEN_AFTER = 3;            // 连续 N 轮没刷到新视频后才放宽窗口
const MAX_LIKES_PER_HOUR = 300;          // 每小时点赞上限(软性防护，非B站硬性规则；已适当放宽，真正风控由 -352/-412/-509 退避兜底)
const WINDOW_BASE_MIN = 60;              // 上限窗口基准(分钟)
const WINDOW_JITTER_MIN = 15;            // 窗口抖动(分钟)：实际窗口在 基准±抖动 间随机，避免整点规律重置
const RISK_BACKOFF_MS = 10 * 60 * 1000;  // 命中风控/限流(-352/-412/-509)时退避 10 分钟
const HISTORY_KEEP_DAYS = 7;             // 已处理记录保留天数，到期清理以限大小
const STARTUP_DELAY = 2000;              // 启动后首次运行延迟(毫秒)，按你要求改为 2 秒

// ---------- 多标签页单实例协调 ----------
const LEADER_KEY = "BiliLike_Leader";
const LEADER_LEASE_MS = 90 * 1000;       // 主实例租约：超过此时间无心跳则其他标签页可接管
const LEADER_HEARTBEAT_MS = 30 * 1000;   // 主实例心跳间隔(远小于租约，避免误判失联)
const LEADER_POLL_MS = 15 * 1000;        // 待命标签页检测主实例是否存活的轮询间隔

// ---------- 接口常量 ----------
const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const LIKE_URL = "https://api.bilibili.com/x/web-interface/archive/like";

// ---------- 运行状态 ----------
let isRunning = false;
let bili_jct = "";
let myInfo = null;          // 登录信息(含 mid)，用于跳过自己的视频
let backoffUntil = 0;       // 风控退避截止时间戳
let checkIntervalMs = CHECK_INTERVAL_BASE * 1000; // 当前检测间隔(毫秒)，按是否易达上限自适应调整
let keywordIdx = -1;              // 轮询关键词索引(round-robin，确保每次换词不重复)
let freshWindowMin = FRESH_WINDOW_MIN;    // 当前生效的新鲜度窗口(分钟)，没刷到时自动放宽、刷到后恢复
let noHitStreak = 0;                     // 连续未刷到新视频的轮数(达到阈值触发窗口放宽)
let totalLiked = 0;             // 累计已点赞总数（持久化，仅递增、不受 7 天清理影响）
const myTabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // 本实例唯一ID(每次页面加载重新生成)
let iAmLeader = false;          // 本标签页是否当前“主实例”(唯一真正干活的)
let standbyLogged = false;      // 待命提示是否已输出过(避免刷屏)
let heartbeatTimer = null;      // 主实例心跳定时器
let scheduledTimer = null;      // 自调度定时器句柄(用于避免重复调度)
let forceRun = false;           // “立即运行一次”请求：强制本标签页接管并立即跑一轮

// ---------- 日志工具(青色高亮，与刷经验脚本一致风格) ----------
const LOG_PREFIX = "[AutoLike]";
function getTimeStr() {
    let now = new Date();
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}
const log = (msg, ...args) => console.log(`%c${getTimeStr()} ${LOG_PREFIX} ${msg}`, "color: #00a1d6; font-weight: bold;", ...args);
const err = (msg, ...args) => console.error(`${getTimeStr()} ${LOG_PREFIX} ${msg}`, ...args);
const wait = (n) => new Promise(resolve => setTimeout(resolve, n));

// 主实例心跳：周期性刷新 LEADER_KEY 的 ts，让其他标签页知道本实例仍存活
function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
        GM.setValue(LEADER_KEY, { id: myTabId, ts: Date.now() }).catch(() => {});
    }, LEADER_HEARTBEAT_MS);
}
function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function getCookie(cname) {
    let name = cname + "=";
    let ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
    }
    return "";
}

// ---------- 纯 JS MD5(标准实现，用于 WBI 签名) ----------
function md5(string) {
    function rotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function addUnsigned(x, y) {
        let lsw = (x & 0xFFFF) + (y & 0xFFFF);
        let msw = (x >> 16) + (y >> 16) + (lsw >> 16);
        return (msw << 16) | (lsw & 0xFFFF);
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return x ^ y ^ z; }
    function I(x, y, z) { return y ^ (x | (~z)); }
    function FF(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function GG(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function HH(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function II(a, b, c, d, x, s, ac) { a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac)); return addUnsigned(rotateLeft(a, s), b); }
    function convertToWordArray(s) {
        let wordArray = [];
        for (let i = 0; i < s.length * 8; i += 8) wordArray[i >> 5] |= (s.charCodeAt(i / 8) & 0xFF) << (i % 32);
        wordArray[((s.length * 8) >> 5)] |= 0x80 << ((s.length * 8) % 32);
        wordArray[(((s.length * 8) + 64) >> 9 << 4) + 14] = s.length * 8;
        return wordArray;
    }
    function wordToHex(lValue) {
        let v = "", t, lByte;
        for (let i = 0; i <= 3; i++) { lByte = (lValue >>> (i << 3)) & 255; t = "0" + lByte.toString(16); v += t.substr(t.length - 2, 2); }
        return v;
    }
    let s = string.replace(/\r\n/g, "\n"), utftext = "";
    for (let n = 0; n < s.length; n++) {
        let c = s.charCodeAt(n);
        if (c < 128) utftext += String.fromCharCode(c);
        else if (c > 127 && c < 2048) { utftext += String.fromCharCode((c >> 6) | 192); utftext += String.fromCharCode((c & 63) | 128); }
        else { utftext += String.fromCharCode((c >> 12) | 224); utftext += String.fromCharCode(((c >> 6) & 63) | 128); utftext += String.fromCharCode((c & 63) | 128); }
    }
    let x = convertToWordArray(utftext);
    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
    for (let k = 0; k < x.length; k += 16) {
        let AA = a, BB = b, CC = c, DD = d;
        a = FF(a, b, c, d, x[k], 7, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], 12, 0xE8C7B756); c = FF(c, d, a, b, x[k + 2], 17, 0x242070DB); b = FF(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], 7, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], 12, 0x4787C62A); c = FF(c, d, a, b, x[k + 6], 17, 0xA8304613); b = FF(b, c, d, a, x[k + 7], 22, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], 7, 0x698098D8); d = FF(d, a, b, c, x[k + 9], 12, 0x8B44F7AF); c = FF(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], 22, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], 7, 0x6B901122); d = FF(d, a, b, c, x[k + 13], 12, 0xFD987193); c = FF(c, d, a, b, x[k + 14], 17, 0xA679438E); b = FF(b, c, d, a, x[k + 15], 22, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], 5, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], 9, 0xC040B340); c = GG(c, d, a, b, x[k + 11], 14, 0x265E5A51); b = GG(b, c, d, a, x[k], 20, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], 5, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], 9, 0x02441453); c = GG(c, d, a, b, x[k + 15], 14, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], 5, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], 9, 0xC33707D6); c = GG(c, d, a, b, x[k + 3], 14, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], 20, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], 5, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8); c = GG(c, d, a, b, x[k + 7], 14, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], 4, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], 11, 0x8771F681); c = HH(c, d, a, b, x[k + 11], 16, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], 23, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], 4, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], 11, 0x4BDECFA9); c = HH(c, d, a, b, x[k + 7], 16, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], 23, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], 4, 0x289B7EC6); d = HH(d, a, b, c, x[k], 11, 0xEAA127FA); c = HH(c, d, a, b, x[k + 3], 16, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], 23, 0x04881D05);
        a = HH(a, b, c, d, x[k + 9], 4, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], 11, 0xE6DB99E5); c = HH(c, d, a, b, x[k + 15], 16, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], 23, 0xC4AC5665);
        a = II(a, b, c, d, x[k], 6, 0xF4292244); d = II(d, a, b, c, x[k + 7], 10, 0x432AFF97); c = II(c, d, a, b, x[k + 14], 15, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], 21, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], 6, 0x655B59C3); d = II(d, a, b, c, x[k + 3], 10, 0x8F0CCC92); c = II(c, d, a, b, x[k + 10], 15, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], 21, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], 6, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0); c = II(c, d, a, b, x[k + 6], 15, 0xA3014314); b = II(b, c, d, a, x[k + 13], 21, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], 6, 0xF7537E82); d = II(d, a, b, c, x[k + 11], 10, 0xBD3AF235); c = II(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], 21, 0xEB86D391);
        a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
    }
    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

// ---------- WBI 签名(全本地自动完成，按日缓存) ----------
const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];

function getMixinKey(orig) {
    let key = "";
    for (let i = 0; i < 64; i++) key += orig[MIXIN_KEY_ENC_TAB[i]];
    return key.slice(0, 32);
}

async function getWbiKeys() {
    let dayStr = new Date().toDateString();
    let cached = await GM.getValue("BiliLike_WbiKeys", null);
    if (cached && cached.day === dayStr) return cached;
    let nav = await requestAPI(NAV_URL, "GET"); // 注意：此处 requestAPI 在定义后可用(函数声明提升)
    if (nav.code !== 0 || !nav.data?.wbi_img) throw new Error("无法获取 wbi_img");
    let imgKey = nav.data.wbi_img.img_url.split('/').pop().split('.')[0];
    let subKey = nav.data.wbi_img.sub_url.split('/').pop().split('.')[0];
    let result = { imgKey, subKey, mixinKey: getMixinKey(imgKey + subKey), day: dayStr };
    await GM.setValue("BiliLike_WbiKeys", result);
    return result;
}

async function signWbi(params) {
    let keys = await getWbiKeys();
    let p = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
    let q = Object.keys(p).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`).join('&');
    p.w_rid = md5(q + keys.mixinKey);
    return p;
}

// ---------- 通用请求(GM_xmlhttpRequest + 主站伪装) ----------
async function requestAPI(url, method = "GET", dataObj = null, opts = {}) {
    let headers = {
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.bilibili.com",
        "Referer": opts.referer || "https://www.bilibili.com/"
    };
    let body = null, reqUrl = url;

    if (method === "GET") {
        if (opts.wbi) {
            let signed = await signWbi(dataObj || {});
            let qs = Object.keys(signed).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(signed[k])).join('&');
            reqUrl += (reqUrl.includes('?') ? '&' : '?') + qs;
        } else if (dataObj) {
            let qs = Object.keys(dataObj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(dataObj[k])).join('&');
            reqUrl += (reqUrl.includes('?') ? '&' : '?') + qs + "&_t=" + Date.now();
        } else {
            reqUrl += (reqUrl.includes('?') ? '&' : '?') + "_t=" + Date.now();
        }
    } else if (method === "POST" && dataObj) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        let formBody = [];
        for (let property in dataObj) formBody.push(encodeURIComponent(property) + "=" + encodeURIComponent(dataObj[property]));
        body = formBody.join("&");
    }

    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            method: method, url: reqUrl, headers: headers, data: body,
            withCredentials: true,
            onload: function (res) {
                try { resolve(JSON.parse(res.responseText)); }
                catch (e) { resolve({ code: -1, msg: "JSON解析失败" }); }
            },
            onerror: function () { resolve({ code: -1, msg: "网络请求失败" }); }
        });
    });
}

// ---------- 已处理记录(GM 持久化) ----------
// 记录“已点赞”或“已判定过”的视频，确保“首次见到即处理、之后绝不再碰”，这是秒赞不漏赞、不重复赞的关键
async function loadProcessed() { return await GM.getValue("BiliLike_Processed", {}); }
async function saveProcessed(map) { await GM.setValue("BiliLike_Processed", map); }
async function pruneProcessed() {
    let map = await loadProcessed();
    let cutoff = Date.now() - HISTORY_KEEP_DAYS * 86400 * 1000;
    let changed = false;
    for (let k in map) if (map[k].ts < cutoff) { delete map[k]; changed = true; }
    if (changed) await saveProcessed(map);
}

// 累计已点赞总数：仅递增，不在此落盘；统一在每轮结束随已处理表批量持久化
function incTotalLiked() {
    totalLiked++;
}

// ---------- 拉取最新视频(关键词 + 发布时间排序) ----------
async function fetchLatestVideos(keyword, pn) {
    let res = await requestAPI(SEARCH_URL, "GET", {
        search_type: "video", keyword: keyword, order: "pubdate", pn: pn, ps: 30, highlight: 0
    }, { wbi: true });
    if (res.code !== 0 || !Array.isArray(res.data?.result)) return [];
    return res.data.result.filter(v => v && v.type === "video" && (v.aid || v.bvid));
}

// 拉取某关键词“最新”页(pn=1)，筛出本轮要“秒赞”的候选；
// 同时把已判定(自己的/过旧/已处理)的视频标记，避免以后反复拉取浪费请求
// 复用调用方已加载的 processed 表，原地标记“非新鲜/自己的”视频并直接返回候选；
// 不在内部落盘，交由 runLoop 在每轮结束统一批量保存，避免重复全量读写
async function collectCandidates(keyword, processed) {
    let list = await fetchLatestVideos(keyword, 1); // 永远只看最新一页
    if (list.length === 0) { log(`拉取关键词="${keyword}" 未获取到视频`); return { candidates: [], dirty: false }; }
    log(`拉取关键词="${keyword}" 最新视频 ${list.length} 条`);

    let myMid = myInfo?.mid || 0;
    let now = Date.now(), freshMs = freshWindowMin * 60000, maxFreshMs = FRESH_WINDOW_MAX * 60000;
    let dirty = false, candidates = [];

    for (let v of list) {
        if (!v.bvid) continue;
        if (processed[v.bvid]) continue;                                                  // 已处理过(点过或判定过)
        if (myMid && String(v.mid) === String(myMid)) { processed[v.bvid] = { liked: false, ts: now }; dirty = true; continue; } // 自己的不点
        let pub = (v.pubdate || v.senddate) * 1000;
        if (!pub || now - pub > maxFreshMs) { processed[v.bvid] = { liked: false, ts: now }; dirty = true; continue; }          // 超过最大窗口才标记跳过(留给窗口放宽后重试)
        if (now - pub > freshMs) continue;                                                // 当前窗口外、最大窗口内：不标记，留待窗口放宽后重试
        candidates.push(v);                                                                // 刚上传 + 未处理 → 秒赞候选
    }
    return { candidates, dirty };
}

// ---------- 点赞 ----------
async function likeVideo(v) {
    return await requestAPI(LIKE_URL, "POST", {
        aid: v.aid || 0, bvid: v.bvid, like: 1, csrf: bili_jct
    }, { referer: `https://www.bilibili.com/video/${v.bvid}` });
}

// ---------- 主循环：按自适应间隔检测 + 发现刚上传的视频立即秒赞 ----------
let limitLogged = false;   // 本轮“达每小时上限”是否已提示过（避免反复刷屏）
let backoffLogged = false; // 本轮“风控退避”是否已提示过

function fmtPubdate(tsSec) {
    if (!tsSec) return "未知";
    let d = new Date(tsSec * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 高频轮询优先：保持短间隔以最大化秒赞；降频只发生在命中 B 站风控/限流(-352/-412/-509)时的退避逻辑，不在此主动拉长。
function adaptCheckInterval(st, likedThisCycle) {
    const MIN = CHECK_INTERVAL_MIN * 1000;
    checkIntervalMs = Math.max(MIN, CHECK_INTERVAL_BASE * 1000);
}

async function runLoop() {
    if (isRunning) return;
    isRunning = true;
    let nextDelay = null; // null=用自适应检测间隔；否则按指定毫秒后唤醒(退避/达上限时睡到期限结束)
    let enabled = true;
    try {
        enabled = await GM.getValue("BiliLike_Enabled", true);
        if (!enabled) { log("[暂停中] 自动点赞已关闭"); return; }

        // 多标签页单实例协调：仅一个标签页作为“主实例”真正干活，其余待命；主实例失联(关页/崩溃)后其他标签页自动接管
        let leader = await GM.getValue(LEADER_KEY, null);
        let now = Date.now();
        let leaderAlive = leader && leader.id !== myTabId && (now - leader.ts <= LEADER_LEASE_MS);
        if (leaderAlive && !forceRun) {
            iAmLeader = false;
            stopHeartbeat();
            if (!standbyLogged) { log(`[待命] 检测到主实例(标签页 ${leader.id}) 运行中，本标签页待命，每 ${Math.round(LEADER_POLL_MS / 1000)}s 检测一次`); standbyLogged = true; }
            nextDelay = LEADER_POLL_MS;
            return;
        }
        if (!iAmLeader || forceRun) log(leader ? (forceRun ? `[接管] 强制接管自动点赞` : `[接管] 主实例失联，本标签页接管自动点赞`) : `[接管] 无主实例，本标签页开始执行自动点赞`);
        iAmLeader = true;
        standbyLogged = false;
        startHeartbeat();
        await GM.setValue(LEADER_KEY, { id: myTabId, ts: now });
        if (forceRun) forceRun = false;

        // 风控退避：仅提示一次，之后静默等待，到点再继续检测
        if (Date.now() < backoffUntil) {
            if (!backoffLogged) {
                log(`⚠️ 风控/限流退避中，剩余 ${Math.ceil((backoffUntil - Date.now()) / 1000)}s 后恢复，期间停止检测`);
                backoffLogged = true;
            }
            nextDelay = backoffUntil - Date.now();
            return;
        }
        backoffLogged = false;

        bili_jct = getCookie("bili_jct");
        if (!bili_jct) { log("[未登录] 未检测到 bili_jct，请确保已在 B 站登录"); return; }

        if (!myInfo) {
            let nav = await requestAPI(NAV_URL, "GET");
            if (nav.code !== 0 || !nav.data?.isLogin) { log("[未登录] 登录校验失败"); return; }
            myInfo = nav.data;
            log(`👤 登录成功: ${myInfo.uname} (mid:${myInfo.mid})`);
        }

        // 每小时窗口与上限（窗口长度在“1小时±抖动”间随机，避免整点规律重置）
        let st = await GM.getValue("BiliLike_Hour", { start: 0, count: 0, len: 0 });
        if (typeof st.len !== 'number' || Date.now() - st.start >= st.len) {
            st = { start: Date.now(), len: (WINDOW_BASE_MIN + (Math.random() * 2 - 1) * WINDOW_JITTER_MIN) * 60000, count: 0 };
            await GM.setValue("BiliLike_Hour", st);
            limitLogged = false; // 新窗口开始，重置“已提示”标记
        }
        if (st.count >= MAX_LIKES_PER_HOUR) {
            if (!limitLogged) {
                let remain = Math.ceil((st.start + st.len - Date.now()) / 1000);
                log(`🚫 已达每小时点赞上限 ${MAX_LIKES_PER_HOUR}，剩余 ${remain}s 后恢复，期间停止检测与日志`);
                limitLogged = true;
            }
            nextDelay = st.start + st.len - Date.now(); // 静默睡到本窗口结束再继续
            return;
        }

        // 本轮检测 + 瞬时秒赞：取一个关键词的最新页，发现刚上传的视频立即全点
        keywordIdx = (keywordIdx + 1) % KEYWORDS.length;
        let keyword = KEYWORDS[keywordIdx];
        let processed = await loadProcessed();
        // 复用本轮已加载的表原地做 7 天清理，随下方统一保存，避免长期运行下已处理表无限增长
        let cutoff = Date.now() - HISTORY_KEEP_DAYS * 86400 * 1000;
        let pruned = false;
        for (let k in processed) if (processed[k].ts < cutoff) { delete processed[k]; pruned = true; }
        let { candidates, dirty: candsDirty } = await collectCandidates(keyword, processed);
        let processedDirty = candsDirty || pruned;
        let likedThisCycle = 0;
        for (let v of candidates) {
            if (Date.now() < backoffUntil) break;
            if (st.count >= MAX_LIKES_PER_HOUR) {
                if (!limitLogged) {
                    let remain = Math.ceil((st.start + st.len - Date.now()) / 1000);
                    log(`🚫 已达每小时点赞上限 ${MAX_LIKES_PER_HOUR}，剩余 ${remain}s 后恢复，期间停止检测与日志`);
                    limitLogged = true;
                }
                nextDelay = st.start + st.len - Date.now();
                break;
            }
            let res = await likeVideo(v);
            let title = (v.title || "").replace(/<[^>]+>/g, '');
            if (res.code === 0) {
                processed[v.bvid] = { liked: true, ts: Date.now() };
                processedDirty = true;
                st.count++;
                incTotalLiked();
                // 附上上传时间，以及搜索结果里顺带有的播放量/点赞量（不额外调接口）
                let pub = fmtPubdate(v.pubdate || v.senddate);
                let extra = [];
                if (typeof v.play === 'number') extra.push(`播放 ${v.play}`);
                if (typeof v.like === 'number') extra.push(`点赞 ${v.like}`);
                let extraStr = extra.length ? ` [${extra.join(' / ')}]` : '';
                log(`⚡ 秒赞成功: 《${title}》 上传于 ${pub}${extraStr} BVID:${v.bvid} [本小时 ${st.count}/${MAX_LIKES_PER_HOUR}] [累计 ${totalLiked}]`);
                likedThisCycle++;
                let cd = (CYCLE_LIKE_COOLDOWN_MIN + Math.random() * (CYCLE_LIKE_COOLDOWN_MAX - CYCLE_LIKE_COOLDOWN_MIN)) * 1000;
                await wait(cd);
            } else if (res.code === 65006) {
                processed[v.bvid] = { liked: true, ts: Date.now() };
                processedDirty = true;
                log(`↩️ 已点赞过(重复): BVID:${v.bvid}`); // 不计入本轮，继续看下一个候选
            } else if (res.code === -101) {
                myInfo = null;
                log(`⚠️ 账号凭证失效(code:-101)，下次重新登录校验`);
                break;
            } else if (res.code === -352 || res.code === -412 || res.code === -509) {
                backoffUntil = Date.now() + RISK_BACKOFF_MS;
                backoffLogged = true;
                nextDelay = backoffUntil - Date.now();
                log(`⚠️ 触发风控/限流(code:${res.code})，自动退避 ${RISK_BACKOFF_MS / 60000} 分钟`);
                break;
            } else if (res.code === -111) {
                log(`⚠️ CSRF 失效(code:-111)，请重新登录`);
            } else if (res.code === -403) {
                log(`⚠️ 账号异常(code:-403)，停止点赞`);
                break;
            } else {
                log(`⚠️ 点赞失败(code:${res.code})`, res.message || res.msg || '');
            }
        }

        // 本轮持久化：批量落盘一次，避免“每赞一次就全量读+写一次已处理表”的 O(n²) 存储开销
        if (processedDirty) await saveProcessed(processed);
        if (likedThisCycle > 0) {
            await GM.setValue("BiliLike_Hour", st);
            await GM.setValue("BiliLike_TotalLiked", totalLiked);
        }

        // 本轮结束：决定下一轮间隔与新鲜度窗口
        if (likedThisCycle > 0) {
            // 刷到了 → 恢复基础窗口、重置连错计数，用自适应较长间隔铺开
            if (freshWindowMin !== FRESH_WINDOW_MIN) {
                log(`✅ 刷到新视频，新鲜度窗口恢复为 ${FRESH_WINDOW_MIN} 分钟`);
                freshWindowMin = FRESH_WINDOW_MIN;
            }
            noHitStreak = 0;
            adaptCheckInterval(st, likedThisCycle);
            nextDelay = checkIntervalMs;
        } else {
            // 没刷到 → 连错+1，达到阈值则放宽窗口，短间隔快速换词继续轮询
            noHitStreak++;
            if (noHitStreak >= NO_HIT_WIDEN_AFTER && freshWindowMin < FRESH_WINDOW_MAX) {
                let prev = freshWindowMin;
                freshWindowMin = Math.min(FRESH_WINDOW_MAX, freshWindowMin + FRESH_WINDOW_WIDEN_STEP);
                noHitStreak = 0;
                log(`🔎 连续 ${NO_HIT_WIDEN_AFTER} 轮无新视频，新鲜度窗口放宽 ${prev}→${freshWindowMin} 分钟`);
            }
            nextDelay = NO_HIT_POLL_MS;
        }
        log(`🔍 本轮检测完成：候选 ${candidates.length} 个，秒赞 ${likedThisCycle} 个，窗口 ${freshWindowMin} 分钟，下一轮间隔 ${(nextDelay / 1000).toFixed(0)}s`);
    } catch (e) {
        err("[循环异常]", e);
    } finally {
        isRunning = false;
        if (enabled) {
            let delay = (nextDelay != null) ? nextDelay : checkIntervalMs;
            scheduledTimer = setTimeout(runLoop, Math.max(1000, delay));
        }
    }
}

// ---------- 菜单命令 ----------
if (typeof GM_registerMenuCommand !== "undefined") {
    GM_registerMenuCommand("▶/⏸ 暂停/继续自动点赞", async () => {
        let cur = await GM.getValue("BiliLike_Enabled", true);
        let next = !cur;
        await GM.setValue("BiliLike_Enabled", next);
        log(next ? "▶ 已恢复自动点赞" : "⏸ 已暂停自动点赞");
        if (next && !isRunning) setTimeout(runLoop, 1000);
    });
    GM_registerMenuCommand("🔄 立即运行一次", () => {
        if (scheduledTimer) { clearTimeout(scheduledTimer); scheduledTimer = null; }
        forceRun = true;
        if (isRunning) { log("⚡ 立即运行一次(当前轮次结束后马上再跑一轮)"); return; }
        log("⚡ 立即运行一次");
        setTimeout(runLoop, 500);
    });
    GM_registerMenuCommand("📊 查看状态", async () => {
        let map = await loadProcessed();
        let liked = 0;
        for (let k in map) if (map[k].liked) liked++;
        let st = await GM.getValue("BiliLike_Hour", { start: 0, count: 0, len: 0 });
        let inWindow = (typeof st.len === 'number' && Date.now() - st.start < st.len);
        let inHour = inWindow ? st.count : 0;
        let bo = Date.now() < backoffUntil ? Math.ceil((backoffUntil - Date.now()) / 1000) + "s" : "否";
        let en = await GM.getValue("BiliLike_Enabled", true);
        log(`📊 状态: 启用=${en} | 已处理=${Object.keys(map).length}条(其中已赞${liked}) | 本小时=${inHour}/${MAX_LIKES_PER_HOUR} | 累计已赞=${totalLiked} | 退避=${bo} | 运行中=${isRunning}`);
    });
    GM_registerMenuCommand("🧹 清空已处理记录", async () => {
        await GM.setValue("BiliLike_Processed", {});
        totalLiked = 0;
        await GM.setValue("BiliLike_TotalLiked", 0);
        log("🧹 已清空已处理记录与累计已赞(换号/测试用)");
    });
}

// 主实例关闭标签页时释放租约，让其他标签页尽快接管
window.addEventListener("pagehide", () => {
    stopHeartbeat();
    if (iAmLeader) GM.setValue(LEADER_KEY, null).catch(() => {});
});

// ---------- 启动 ----------
(async function () {
    log("脚本已启动，初始化中…");
    if (window.top !== window.self) return;
    if (window.location.href.includes("passport.bilibili.com")) return;
    totalLiked = (await GM.getValue("BiliLike_TotalLiked", 0)) || 0;
    await pruneProcessed();
    setTimeout(runLoop, STARTUP_DELAY); // 启动后短延迟首次运行，之后自调度持续运行
})();
