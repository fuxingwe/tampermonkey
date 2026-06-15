// ==UserScript==
// @name         BilibiliExp - 全域隐形挂机守护版 (需开B站页面)
// @namespace    BilibiliExp
// @match        *://*.bilibili.com/*
// @noframes
// @version      3.1.7
// @author       Dreace & Repairer & Gemini
// @description  真正的全自动化：增加防重入执行锁，防止手动触发冲突。
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_registerMenuCommand
// @connect      bilibili.com
// @run-at       document-end
// ==/UserScript==

"use strict";

// 全局内存锁，用于防止页面内部瞬间重复触发
let isRunning = false; 

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const REWARD_URL = "https://api.bilibili.com/x/member/web/exp/reward";
const ADD_COIN_URL = "https://api.bilibili.com/x/web-interface/coin/add";
const SHARE_URL = "https://api.bilibili.com/x/web-interface/share/add";
const HOT_VIDEO_URL = "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1";
const HEARTBEAT_URL = "https://api.bilibili.com/x/click-interface/web/heartbeat"; 

let bili_jct = "";

function getTimeStr() {
    let now = new Date();
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

const log = (msg, ...args) => {
    console.log(`%c${getTimeStr()} ${msg}`, "color: #00a1d6; font-weight: bold;", ...args);
};

const err = (msg, ...args) => {
    console.error(`${getTimeStr()} ${msg}`, ...args);
};

// 注册油猴菜单：手动强制执行按钮
if (typeof GM_registerMenuCommand !== "undefined") {
    GM_registerMenuCommand("🔄 强制重置并运行任务", async () => {
        if (isRunning) return log("[BilibiliExp] ⚠️ 任务正在运行中，请勿重复点击。");
        log("[BilibiliExp] 🔄 收到手动重置指令...");
        await GM.setValue("BiliExp_LastDate", "");
        await GM.setValue("BiliExp_Lock", 0);
        await tryExecuteWorkflow();
    });
}

// 异步初始化
(async function() {
    log(`[BilibiliExp] 脚本已启动，正在初始化...`);
    // 双重保险：确保不在 iframe 中运行
    if (window.top !== window.self) return;

    const curUrl = window.location.href;
    
    // 过滤B站敏感页面及其他不需要运行的特定页面
    if (curUrl.includes("passport.bilibili.com") || 
        curUrl.includes("netflix") || 
        curUrl.includes("youtube") || 
        curUrl.includes("bank")) {
        return;
    }

    setInterval(async () => {
        await tryExecuteWorkflow();
    }, 240 * 60 * 1000);

    setTimeout(async () => {
        await tryExecuteWorkflow();
    }, 5000);
})();

// 核心执行逻辑：加入内存锁
async function tryExecuteWorkflow() {
    if (isRunning) return; // 内存锁：阻止单页面重复进入
    isRunning = true;
    
    try {
        let currentDateStr = new Date().toDateString(); 
        let lastRunDate = await GM.getValue("BiliExp_LastDate", "");
        
        log(`[BilibiliExp] 守护线程触发检测。今日状态: ${lastRunDate === currentDateStr ? "✅ 已完成" : "⏳ 待执行"}`);

        if (lastRunDate === currentDateStr) return;

        let lockTime = await GM.getValue("BiliExp_Lock", 0);
        if (Date.now() - lockTime < 5 * 60 * 1000) {
            log("[BilibiliExp] 别的标签页正在执行，本页面跳过。");
            return; 
        }
        
        await GM.setValue("BiliExp_Lock", Date.now());
        
        let navRes = await gmAjax(NAV_URL);
        if (navRes.code !== 0 || !navRes.data?.isLogin) {
            log("[BilibiliExp] 未登录或无法获取状态。");
            return;
        }

        bili_jct = getBiliJctFromCookie(navRes.cookieRaw);
        await startHiddenTask(currentDateStr);
        
    } finally {
        isRunning = false;
        await GM.setValue("BiliExp_Lock", 0);
    }
}

async function startHiddenTask(currentDateStr) {
    try {
        let rewardRes = await gmAjax(REWARD_URL);
        if (rewardRes.code !== 0) return;

        let rewardData = rewardRes.data;
        let coinExp = (rewardData.coins !== undefined) ? rewardData.coins : (rewardData.coin_exp || 0);
        let hasWatched = (rewardData.watch !== undefined) ? rewardData.watch : (rewardData.watch_av || false);

        // 校验是否全部完成
        if (rewardData.login && hasWatched && rewardData.share && coinExp >= 50) {
            log("[BilibiliExp] 🎉 检测到今日所有经验已满！标记今日任务完成。");
            await GM.setValue("BiliExp_LastDate", currentDateStr);
            return;
        }

        // 抓取热门视频作为素材池
        let hotRes = await gmAjax(HOT_VIDEO_URL);
        if (hotRes.code !== 0 || !Array.isArray(hotRes.data?.list)) {
            log("[BilibiliExp] 无法获取B站热门视频池，放弃本次执行。");
            return;
        }
        
        // 升级素材池
        let videoPool = hotRes.data.list.map(v => ({
            aid: v.aid,
            bvid: v.bvid,
            cid: v.cid
        })).filter(v => v.aid && v.cid && v.bvid);

        if (videoPool.length === 0) return;
        let randomVideo = videoPool[Math.floor(Math.random() * videoPool.length)];
        let videoReferer = `https://www.bilibili.com/video/${randomVideo.bvid}/`;

        // 0. 模拟观看视频
        if (!hasWatched) {
            log(`[BilibiliExp] 后台正在隐形观看视频(BVID:${randomVideo.bvid})...`);
            let watchRes = await gmPostAjax(HEARTBEAT_URL, {
                aid: randomVideo.aid,
                bvid: randomVideo.bvid,
                cid: randomVideo.cid,
                mid: (await GM.getValue("BiliExp_Mid", 0)) || "", 
                played_time: 35,
                realtime: 35,
                start_ts: Math.floor(Date.now() / 1000) - 35,
                type: 3,
                sub_type: 0,
                dt: 2, 
                play_type: 0,
                csrf: bili_jct
            }, videoReferer);
            log(`[BilibiliExp] 观看请求结果:`, watchRes.code === 0 ? "成功" : watchRes);
            await wait(3000);
        }

        // 1. 模拟分享
        if (!rewardData.share) {
            log(`[BilibiliExp] 后台正在隐形分享视频(BVID:${randomVideo.bvid})...`);
            let shareRes = await gmPostAjax(SHARE_URL, { 
                aid: randomVideo.aid, 
                bvid: randomVideo.bvid, 
                csrf: bili_jct 
            }, videoReferer);
            log(`[BilibiliExp] 分享请求结果:`, shareRes.code === 0 ? "成功" : shareRes);
            await wait(3000);
        }

        // 2. 模拟投币
        if (coinExp < 50) {
            let totalMoney = (await gmAjax(NAV_URL)).data?.money || 0;
            if (totalMoney >= 5) { 
                let needExp = 50 - coinExp;
                log(`[BilibiliExp] 投币经验未满(差${needExp}点)，硬币余额: ${totalMoney}。开始跨视频后台连投...`);

                for (let targetVideo of videoPool) {
                    if (needExp <= 0) break;
                    let targetReferer = `https://www.bilibili.com/video/${targetVideo.bvid}/`;

                    let coinRes = await gmPostAjax(ADD_COIN_URL, {
                        aid: targetVideo.aid, 
                        multiply: 1, 
                        select_like: 0, 
                        csrf: bili_jct
                    }, targetReferer);

                    if (coinRes.code === 0) {
                        needExp -= 10;
                        log(`[BilibiliExp] 后台成功为视频(BVID:${targetVideo.bvid})隐形投币1枚。`);
                        await wait(4000);
                    } else if (coinRes.code === -101) {
                        log("[BilibiliExp] 账号凭证失效，终止投币。");
                        break;
                    } else if (coinRes.code === 34005) {
                        log(`[BilibiliExp] 视频(BVID:${targetVideo.bvid})已投过币，跳过。`);
                        await wait(1000);
                    } else {
                        log(`[BilibiliExp] 投币遇到问题: 代码 ${coinRes.code}，尝试下一个。`);
                        await wait(2000);
                    }
                }
            } else {
                log(`[BilibiliExp] 硬币余额较低(${totalMoney})，跳过投币任务以作保留。`);
            }
        }

        // 3. 最终校验与防死循环
        log("[BilibiliExp] 任务命令已发送。强制写入完成标记防止页面刷新时死循环。");
        await GM.setValue("BiliExp_LastDate", currentDateStr);
        
        // 打印最终战果
        await wait(2000);
        let finalReward = await gmAjax(REWARD_URL);
        if(finalReward.code === 0) {
            log(`[BilibiliExp] 今日最终经验结算: 登录[${finalReward.data.login}] 观看[${finalReward.data.watch}] 分享[${finalReward.data.share}] 投币已获EXP[${finalReward.data.coins}]`);
        }

    } catch (e) {
        err("[BilibiliExp] 隐形守护线程发生致命错误", e);
    } finally {
        await GM.setValue("BiliExp_Lock", 0);
    }
}

function gmAjax(url) {
    let noCacheUrl = url + (url.includes('?') ? '&' : '?') + "_t=" + Date.now();
    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "GET",
            url: noCacheUrl,
            withCredentials: true, 
            headers: {
                "Referer": "https://www.bilibili.com/",
                "User-Agent": navigator.userAgent
            },
            onload: (res) => {
                try {
                    let obj = JSON.parse(res.responseText);
                    obj.cookieRaw = res.responseHeaders; 
                    resolve(obj);
                } catch(e) {
                    resolve({ code: -1 });
                }
            },
            onerror: () => resolve({ code: -1 })
        });
    });
}

function gmPostAjax(url, dataObj, customReferer) {
    let formBody = [];
    for (let property in dataObj) {
        formBody.push(encodeURIComponent(property) + "=" + encodeURIComponent(dataObj[property]));
    }
    formBody = formBody.join("&");

    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "POST",
            url: url,
            data: formBody,
            withCredentials: true,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.bilibili.com",
                "Referer": customReferer || "https://www.bilibili.com/"
            },
            onload: (res) => {
                try {
                    resolve(JSON.parse(res.responseText));
                } catch(e) {
                    resolve({ code: -1 });
                }
            },
            onerror: () => resolve({ code: -1 })
        });
    });
}

function getBiliJctFromCookie(headersStr) {
    let inlineJct = getCookie("bili_jct");
    if (inlineJct) return inlineJct;
    if (!headersStr) return "";
    let match = headersStr.match(/bili_jct=([a-f0-9]{32})/i);
    return match ? match[1] : "";
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

function wait(n) { return new Promise(resolve => setTimeout(resolve, n)); }