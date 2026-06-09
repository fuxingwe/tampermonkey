// ==UserScript==
// @name         BilibiliExp - 智能跨视频自动连投版
// @namespace    BilibiliExp
// @match        *://www.bilibili.com/video/*
// @version      2.1.0
// @author       Dreace & Repairer
// @description  B 站经验助手：当前视频投币触及上限时，自动抓取右侧相关推荐视频继续投币，直至今日50经验完全拿满。
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js
// @run-at       document-end
// ==/UserScript==

"use strict";

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const REWARD_URL = "https://api.bilibili.com/x/member/web/exp/reward";
const ADD_COIN_URL = "https://api.bilibili.com/x/web-interface/coin/add";
const SHARE_URL = "https://api.bilibili.com/x/web-interface/share/add";
const RELATED_URL = "https://api.bilibili.com/x/web-interface/archive/related"; // 关联推荐视频接口

let aid = null;
let bili_jct = getCookie("bili_jct");

function getAid() {
    try {
        return unsafeWindow.__INITIAL_STATE__?.aid || 
               unsafeWindow.__INITIAL_STATE__?.videoData?.aid || 
               window.__playinfo__?.aid ||
               unsafeWindow.aid;
    } catch (e) { return null; }
}

setTimeout(() => {
    if (!bili_jct) {
        console.error("[BilibiliExp] 未检测到登录凭证，请先登录B站！");
        return;
    }
    main();
}, 3500);

async function main() {
    aid = getAid();
    if (!aid && unsafeWindow.player?.getOptions) {
        aid = unsafeWindow.player.getOptions().aid;
    }
    if (!aid) {
        console.error("[BilibiliExp] 无法获取初始视频 AID，退出。");
        return;
    }

    console.log("[BilibiliExp] 开始检测今日经验状态...");
    let rewardRes = await gmAjax({ url: REWARD_URL, method: "GET" });
    if (rewardRes.code !== 0) return;

    let rewardData = rewardRes.data;
    // 兼容最新多变字段
    let currentCoinExp = (rewardData.coins !== undefined) ? rewardData.coins : 
                         ((rewardData.coin_exp !== undefined) ? rewardData.coin_exp : 
                         (rewardData.coin || 0));

    // 自动分享
    if (!rewardData.share) {
        console.log("[BilibiliExp] 检测到今日未分享，正在自动分享当前视频...");
        await gmPostAjax(SHARE_URL, { aid: aid, csrf: bili_jct });
    }

    // 智能连投逻辑
    if (currentCoinExp < 50) {
        let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
        let totalMoney = navRes.data?.money || 0;
        console.log(`[BilibiliExp] 当前硬币余额: ${totalMoney}，已获投币经验: ${currentCoinExp}/50`);

        if (totalMoney >= 5) {
            // 1. 先尝试投当前主视频
            currentCoinExp = await coinLoopHandler(aid, currentCoinExp);

            // 2. 如果当前视频投满（或因上限断开）但总经验还没满，开始抓取右侧相关视频流续投
            if (currentCoinExp < 50) {
                console.log("[BilibiliExp] 当前主视频已达投币限制，正在请求相关推荐视频流进行跨视频代投...");
                let relatedRes = await gmAjax({ url: `${RELATED_URL}?aid=${aid}`, method: "GET" });
                
                if (relatedRes.code === 0 && Array.isArray(relatedRes.data)) {
                    // 提取推荐列表里所有的真实有效 aid
                    let videoPool = relatedRes.data.map(v => v.aid).filter(id => id && id !== aid);
                    console.log(`[BilibiliExp] 成功抓取到后台候选相关视频 ${videoPool.length} 个`);

                    for (let nextAid of videoPool) {
                        if (currentCoinExp >= 50) break; // 拿满了，彻底收工
                        
                        console.log(`[BilibiliExp] 转移目标 -> 正在跨视频为推荐资产(AID:${nextAid})尝试投币...`);
                        currentCoinExp = await coinLoopHandler(nextAid, currentCoinExp);
                        await wait(2000); // 跨视频温和过渡，防频率触发拦截
                    }
                } else {
                    console.log("[BilibiliExp] 抓取推荐视频流失败，无法继续连投。");
                }
            }
        } else {
            console.log("[BilibiliExp] 硬币留存低于安全线，放弃投币任务。");
        }
    } else {
        console.log("[BilibiliExp] 今日投币经验已达成上限，无需投币。");
    }

    // 刷新并渲染数据面板
    setTimeout(async () => {
        let finalReward = await gmAjax({ url: REWARD_URL, method: "GET" });
        let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
        if (finalReward.code === 0 && navRes.code === 0) injectUI(finalReward.data, navRes.data);
    }, 2000);
}

// 核心投币动作器（单独封装，支持在一个视频上投到报错为止，并动态更新总经验）
async function coinLoopHandler(targetAid, expTracker) {
    let currentExp = expTracker;
    let maxTryPerVideo = 2; // 单视频最大试错次数，防撞墙死循环
    
    for (let i = 0; i < maxTryPerVideo; i++) {
        if (currentExp >= 50) break;

        let coinRes = await gmPostAjax(ADD_COIN_URL, {
            aid: targetAid,
            multiply: 1,
            select_like: 0,
            csrf: bili_jct
        });

        if (coinRes.code === 0) {
            currentExp += 10;
            console.log(`[BilibiliExp] 成功为 AID:${targetAid} 投币1枚！当前总投币经验累加至: ${currentExp}/50`);
            await wait(2500); // 每次投币之间留出充足的计算间隔
        } else {
            console.log(`[BilibiliExp] 视频(AID:${targetAid})返回结果: ${coinRes.message}`);
            break; // 只要遇到“上限”或“不可投”，立刻跳出，让外层换下一个视频
        }
    }
    return currentExp;
}

function injectUI(reward, nav) {
    let toolbar = document.querySelector(".video-toolbar-container") || document.querySelector(".toolbar-left");
    if (!toolbar) return;

    $("#bili-exp-panel").remove();

    let panel = document.createElement("div");
    panel.id = "bili-exp-panel";
    panel.style = "display: flex; gap: 15px; margin-top: 12px; padding: 8px 12px; background: #f6f7f8; border-radius: 6px; font-size: 12px; color: #61666d; width: 100%; clear: both;";

    let loginOk = reward.login ? "✔️" : "❌";
    let watchOk = reward.watch ? "✔️" : "❌";
    let shareOk = reward.share ? "✔️" : "❌";
    
    let coinExp = (reward.coins !== undefined) ? reward.coins : 
                  ((reward.coin_exp !== undefined) ? reward.coin_exp : 
                  (reward.coin || 0));
                  
    let totalExp = (reward.login ? 5 : 0) + (reward.watch ? 5 : 0) + (reward.share ? 5 : 0) + coinExp;
    let nextLevelDays = "MAX";
    
    if (nav.level_info.current_level < 6) {
        let remainingExp = nav.level_info.next_exp - nav.level_info.current_exp;
        nextLevelDays = Math.ceil(remainingExp / 65) + "天";
    } else { nextLevelDays = "已满级大佬"; }

    panel.innerHTML = `
        <div><b>🤖 智能经验助手</b></div>
        <div>每日登录: ${loginOk}</div>
        <div>观看视频: ${watchOk}</div>
        <div>网页分享: ${shareOk}</div>
        <div>投币经验: 🪙 ${coinExp}/50</div>
        <div>今日总计: 📈 ${totalExp}/65</div>
        <div>升级预计: 📅 <span style="color:#00aeec; font-weight:bold;">${nextLevelDays}</span></div>
    `;
    toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
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

function gmAjax(opt) {
    return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
            method: opt.method,
            url: opt.url,
            headers: { "User-Agent": navigator.userAgent },
            onload: (res) => resolve(JSON.parse(res.responseText)),
            onerror: (err) => reject(err)
        });
    });
}

function gmPostAjax(url, dataObj) {
    let formBody = [];
    for (let property in dataObj) {
        formBody.push(encodeURIComponent(property) + "=" + encodeURIComponent(dataObj[property]));
    }
    formBody = formBody.join("&");

    return new Promise((resolve, reject) => {
        GM.xmlHttpRequest({
            method: "POST",
            url: url,
            data: formBody,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.bilibili.com",
                "Referer": window.location.href
            },
            onload: (res) => resolve(JSON.parse(res.responseText)),
            onerror: (err) => reject(err)
        });
    });
}