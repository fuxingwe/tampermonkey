// ==UserScript==
// @name         BilibiliExp - 全域隐形挂机守护版 (需开B站页面)
// @namespace    BilibiliExp
// @match        *://*.bilibili.com/*
// @noframes
// @version      3.1.2
// @author       Dreace & Repairer & Gemini
// @description  真正的全自动化：自动随机抓取B站热门视频完成每日登录、观看、分享、投币任务。带全局唯一锁，防多开风控。
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @connect      bilibili.com
// @run-at       document-end
// ==/UserScript==

"use strict";

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const REWARD_URL = "https://api.bilibili.com/x/member/web/exp/reward";
const ADD_COIN_URL = "https://api.bilibili.com/x/web-interface/coin/add";
const SHARE_URL = "https://api.bilibili.com/x/web-interface/share/add";
const HOT_VIDEO_URL = "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1";
const HEARTBEAT_URL = "https://api.bilibili.com/x/click-interface/web/heartbeat"; 

let bili_jct = "";

// 异步初始化
(async function() {
    console.log(`[BilibiliExp] start`);
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

// 核心控制
async function tryExecuteWorkflow() {
    let currentDateStr = new Date().toDateString(); 
    let lastRunDate = await GM.getValue("BiliExp_LastDate", "");
    
    console.log(`[BilibiliExp] 隐形守护线程触发检测。今日状态: ${lastRunDate === currentDateStr ? "✅ 已完成" : "⏳ 待执行"}`);

    // 如果今天已经成功刷完了，直接退出
    if (lastRunDate === currentDateStr) {
        return; 
    }

    // 抢占全局执行锁 (有效期5分钟)
    let lockTime = await GM.getValue("BiliExp_Lock", 0);
    if (Date.now() - lockTime < 5 * 60 * 1000) {
        console.log("[BilibiliExp] 别的标签页正在执行任务，本页面静默。");
        return; 
    }
    
    // 成功抢锁
    await GM.setValue("BiliExp_Lock", Date.now());
    console.log("[BilibiliExp] 🚀 成功抢占全局挂机锁，开始在后台静默检测B站经验...");

    // 检查B站登录状态（此步会自动触发B站的每日登录经验）
    let navRes = await gmAjax(NAV_URL);
    if (navRes.code !== 0 || !navRes.data?.isLogin) {
        console.log("[BilibiliExp] 监测到你未登录B站，或当前网页由于跨域安全限制无法读取凭证。30分钟内不再重试。");
        await GM.setValue("BiliExp_Lock", Date.now() + 25 * 60 * 1000); 
        return;
    }

    // 尝试获取 CSRF
    bili_jct = getBiliJctFromCookie(navRes.cookieRaw);
    if (!bili_jct) {
        console.log("[BilibiliExp] 未能在Cookie中截获 bili_jct，300分钟内跳过。");
        await GM.setValue("BiliExp_Lock", Date.now() + 25 * 60 * 1000);
        return;
    }

    // 开始主干业务
    await startHiddenTask(currentDateStr);
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
            console.log("[BilibiliExp] 🎉 检测到今日所有经验已满！标记今日任务完成。");
            await GM.setValue("BiliExp_LastDate", currentDateStr);
            return;
        }

        // 抓取热门视频作为素材池
        let hotRes = await gmAjax(HOT_VIDEO_URL);
        if (hotRes.code !== 0 || !Array.isArray(hotRes.data?.list)) {
            console.log("[BilibiliExp] 无法获取B站热门视频池，放弃本次执行。");
            return;
        }
        
        // 升级素材池：同时提取 aid, bvid, cid 供心跳观看接口使用
        let videoPool = hotRes.data.list.map(v => ({
            aid: v.aid,
            bvid: v.bvid,
            cid: v.cid
        })).filter(v => v.aid && v.cid);

        if (videoPool.length === 0) return;
        let randomVideo = videoPool[Math.floor(Math.random() * videoPool.length)];

        // 0. 模拟观看视频 (补全关键风控参数)
        if (!hasWatched) {
            console.log(`[BilibiliExp] 后台正在隐形观看视频(AID:${randomVideo.aid})...`);
            await gmPostAjax(HEARTBEAT_URL, {
                aid: randomVideo.aid,
                bvid: randomVideo.bvid,
                cid: randomVideo.cid,
                mid: (await GM.getValue("BiliExp_Mid", 0)) || "", // 即使没有也不影响
                played_time: 35,
                realtime: 35,
                start_ts: Math.floor(Date.now() / 1000) - 35,
                type: 3,
                sub_type: 0,
                dt: 2, // 关键参数：2 代表 Web 端网页播放器标识
                play_type: 0,
                csrf: bili_jct
            });
            await wait(3000);
        }

        // 1. 模拟分享
        if (!rewardData.share) {
            console.log(`[BilibiliExp] 后台正在隐形分享视频(AID:${randomVideo.aid})...`);
            await gmPostAjax(SHARE_URL, { aid: randomVideo.aid, csrf: bili_jct });
            await wait(3000);
        }

        // 2. 模拟投币
        if (coinExp < 50) {
            let totalMoney = (await gmAjax(NAV_URL)).data?.money || 0;
            if (totalMoney >= 5) {
                let needExp = 50 - coinExp;
                console.log(`[BilibiliExp] 投币经验未满，硬币余额: ${totalMoney}。开始跨视频后台连投...`);

                for (let targetVideo of videoPool) {
                    if (needExp <= 0) break;

                    let coinRes = await gmPostAjax(ADD_COIN_URL, {
                        aid: targetVideo.aid, multiply: 1, select_like: 0, csrf: bili_jct
                    });

                    if (coinRes.code === 0) {
                        needExp -= 10;
                        console.log(`[BilibiliExp] 后台成功为视频(AID:${targetVideo.aid})隐形投币1枚。`);
                        await wait(4000);
                    } else if (coinRes.code === -101) {
                        console.log("[BilibiliExp] 账号凭证失效，终止投币。");
                        break;
                    } else {
                        await wait(2000);
                    }
                }
            } else {
                console.log(`[BilibiliExp] 硬币余额不足(${totalMoney})，跳过投币任务。`);
            }
        }

        // 3. 最终校验与防死循环
        console.log("[BilibiliExp] 任务命令已全部发送。现强制写入完成标记防止页面刷新时死循环。");
        await GM.setValue("BiliExp_LastDate", currentDateStr);

    } catch (e) {
        console.error("[BilibiliExp] 隐形守护线程发生致命错误", e);
    } finally {
        // 释放锁
        await GM.setValue("BiliExp_Lock", 0);
    }
}

// 跨域异步网络请求器
function gmAjax(url) {
    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "GET",
            url: url,
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

function gmPostAjax(url, dataObj) {
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
                "Referer": "https://www.bilibili.com/"
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