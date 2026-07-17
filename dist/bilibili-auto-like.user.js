// ==UserScript==
// @name         Bilibili 自动点赞 - 最新视频循环版
// @namespace    BilibiliAutoLike
// @match        *://*.bilibili.com/*
// @noframes
// @version      1.0.0
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
const POLL_INTERVAL = 8;                 // 检测轮询间隔(秒)：越小越接近“秒赞”，但搜索请求越频繁
const POLL_JITTER = 3;                   // 轮询抖动(秒)，避免完全规律被识别
const LIKE_COOLDOWN_MIN = 1;             // 连续点赞之间最小冷却(秒) —— 秒赞时极速但略微拟人
const LIKE_COOLDOWN_MAX = 3;             // 连续点赞之间最大冷却(秒)
const FRESH_WINDOW_MIN = 10;             // 只“秒赞”发布于最近 N 分钟内的视频（避开搜索索引延迟，又只盯刚上传的）
const MAX_LIKES_PER_HOUR = 80;           // 每小时点赞上限，防触发风控
const RISK_BACKOFF_MS = 10 * 60 * 1000;  // 命中风控/限流(-352/-412/-509)时退避 10 分钟
const HISTORY_KEEP_DAYS = 7;             // 已处理记录保留天数，到期清理以限大小
const STARTUP_DELAY = 2000;              // 启动后首次运行延迟(毫秒)，按你要求改为 2 秒

// ---------- 接口常量 ----------
const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const LIKE_URL = "https://api.bilibili.com/x/web-interface/archive/like";

// ---------- 运行状态 ----------
let isRunning = false;
let bili_jct = "";
let myInfo = null;          // 登录信息(含 mid)，用于跳过自己的视频
let backoffUntil = 0;       // 风控退避截止时间戳

// ---------- 日志工具(青色高亮，与刷经验脚本一致风格) ----------
function getTimeStr() {
    let now = new Date();
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}
const log = (msg, ...args) => console.log(`%c${getTimeStr()} ${msg}`, "color: #00a1d6; font-weight: bold;", ...args);
const err = (msg, ...args) => console.error(`${getTimeStr()} ${msg}`, ...args);
const wait = (n) => new Promise(resolve => setTimeout(resolve, n));

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
async function markProcessed(bvid, liked) {
    let map = await loadProcessed();
    map[bvid] = { liked: liked, ts: Date.now() };
    await saveProcessed(map);
}
async function pruneProcessed() {
    let map = await loadProcessed();
    let cutoff = Date.now() - HISTORY_KEEP_DAYS * 86400 * 1000;
    let changed = false;
    for (let k in map) if (map[k].ts < cutoff) { delete map[k]; changed = true; }
    if (changed) await saveProcessed(map);
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
async function collectCandidates(keyword) {
    let list = await fetchLatestVideos(keyword, 1); // 永远只看最新一页
    if (list.length === 0) { log(`拉取关键词="${keyword}" 未获取到视频`); return []; }
    log(`拉取关键词="${keyword}" 最新视频 ${list.length} 条`);

    let processed = await loadProcessed();
    let myMid = myInfo?.mid || 0;
    let now = Date.now(), freshMs = FRESH_WINDOW_MIN * 60000;
    let changed = false, candidates = [];

    for (let v of list) {
        if (!v.bvid) continue;
        if (processed[v.bvid]) continue;                                                  // 已处理过(点过或判定过)
        if (myMid && String(v.mid) === String(myMid)) { processed[v.bvid] = { liked: false, ts: now }; changed = true; continue; } // 自己的不点
        let pub = (v.pubdate || v.senddate) * 1000;
        if (!pub || now - pub > freshMs) { processed[v.bvid] = { liked: false, ts: now }; changed = true; continue; }              // 非刚上传，跳过并记住
        candidates.push(v);                                                                // 刚上传 + 未处理 → 秒赞候选
    }
    if (changed) await saveProcessed(processed);
    return candidates;
}

// ---------- 点赞 ----------
async function likeVideo(v) {
    return await requestAPI(LIKE_URL, "POST", {
        aid: v.aid || 0, bvid: v.bvid, like: 1, csrf: bili_jct
    }, { referer: `https://www.bilibili.com/video/${v.bvid}` });
}

// ---------- 主循环：高频检测 + 发现刚上传的视频立即秒赞 ----------
async function runLoop() {
    if (isRunning) return;
    isRunning = true;
    try {
        let enabled = await GM.getValue("BiliLike_Enabled", true);
        if (!enabled) { log("[暂停中] 自动点赞已关闭"); return; }

        if (Date.now() < backoffUntil) {
            log(`[风控退避中] 剩余 ${Math.ceil((backoffUntil - Date.now()) / 1000)}s 后恢复`);
            return;
        }

        bili_jct = getCookie("bili_jct");
        if (!bili_jct) { log("[未登录] 未检测到 bili_jct，请确保已在 B 站登录"); return; }

        if (!myInfo) {
            let nav = await requestAPI(NAV_URL, "GET");
            if (nav.code !== 0 || !nav.data?.isLogin) { log("[未登录] 登录校验失败"); return; }
            myInfo = nav.data;
            log(`👤 登录成功: ${myInfo.uname} (mid:${myInfo.mid})`);
        }

        // 每小时计数
        let st = await GM.getValue("BiliLike_Hour", { start: 0, count: 0 });
        if (Date.now() - st.start >= 3600 * 1000) st = { start: Date.now(), count: 0 };

        // 本轮轮询：取一个关键词的最新页，收集“秒赞”候选
        let keyword = KEYWORDS[Math.floor(Math.random() * KEYWORDS.length)];
        let candidates = await collectCandidates(keyword);

        // 对候选逐个立即点赞（秒赞），连续点赞之间仅留极短冷却
        for (let v of candidates) {
            if (Date.now() < backoffUntil) break;
            if (st.count >= MAX_LIKES_PER_HOUR) {
                log(`[已达每小时上限 ${MAX_LIKES_PER_HOUR}] ${Math.ceil((st.start + 3600 * 1000 - Date.now()) / 1000)}s 后重置`);
                break;
            }
            let res = await likeVideo(v);
            let title = (v.title || "").replace(/<[^>]+>/g, '');
            if (res.code === 0) {
                await markProcessed(v.bvid, true);
                st.count++;
                await GM.setValue("BiliLike_Hour", st);
                log(`⚡ 秒赞成功: 《${title}》 BVID:${v.bvid} [本小时 ${st.count}/${MAX_LIKES_PER_HOUR}]`);
            } else if (res.code === 65006) {
                await markProcessed(v.bvid, true);
                log(`↩️ 已点赞过(重复): BVID:${v.bvid}`);
            } else if (res.code === -101) {
                myInfo = null;
                log(`⚠️ 账号凭证失效(code:-101)，下次重新登录校验`);
                break;
            } else if (res.code === -352 || res.code === -412 || res.code === -509) {
                backoffUntil = Date.now() + RISK_BACKOFF_MS;
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
            let cd = (LIKE_COOLDOWN_MIN + Math.random() * (LIKE_COOLDOWN_MAX - LIKE_COOLDOWN_MIN)) * 1000;
            await wait(cd);
        }
    } catch (e) {
        err("[循环异常]", e);
    } finally {
        isRunning = false;
        let enabled = await GM.getValue("BiliLike_Enabled", true);
        if (enabled) {
            let delay = (POLL_INTERVAL + Math.random() * (2 * POLL_JITTER) - POLL_JITTER) * 1000;
            setTimeout(runLoop, Math.max(1000, delay));
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
        if (isRunning) { log("正在运行中，请稍候"); return; }
        setTimeout(runLoop, 500);
    });
    GM_registerMenuCommand("📊 查看状态", async () => {
        let map = await loadProcessed();
        let liked = 0;
        for (let k in map) if (map[k].liked) liked++;
        let st = await GM.getValue("BiliLike_Hour", { start: 0, count: 0 });
        let inHour = (Date.now() - st.start < 3600 * 1000) ? st.count : 0;
        let bo = Date.now() < backoffUntil ? Math.ceil((backoffUntil - Date.now()) / 1000) + "s" : "否";
        let en = await GM.getValue("BiliLike_Enabled", true);
        log(`📊 状态: 启用=${en} | 已处理=${Object.keys(map).length}条(其中已赞${liked}) | 本小时=${inHour}/${MAX_LIKES_PER_HOUR} | 退避=${bo} | 运行中=${isRunning}`);
    });
    GM_registerMenuCommand("🧹 清空已处理记录", async () => {
        await GM.setValue("BiliLike_Processed", {});
        log("🧹 已清空已处理记录(换号/测试用)");
    });
}

// ---------- 启动 ----------
(async function () {
    log("脚本已启动，初始化中…");
    if (window.top !== window.self) return;
    if (window.location.href.includes("passport.bilibili.com")) return;
    await pruneProcessed();
    setTimeout(runLoop, STARTUP_DELAY); // 启动后短延迟首次运行，之后自调度持续运行
})();
