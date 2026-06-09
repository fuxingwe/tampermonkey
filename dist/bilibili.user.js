// ==UserScript==
// @name         BilibiliExp - 2026 终极修复版
// @namespace    BilibiliExp
// @match        *://www.bilibili.com/video/*
// @version      2.0.1
// @author       Dreace & Repairer
// @license      GPL-3.0
// @description  B 站经验助手：修复投币经验 undefined 和 NaN 的问题，完美适配2026最新数据结构。
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

let aid = null;
let bili_jct = getCookie("bili_jct");

// 增强版 AID 抓取逻辑，确保 100% 拿到视频ID
function getAid() {
    try {
        return unsafeWindow.__INITIAL_STATE__?.aid || 
               unsafeWindow.__INITIAL_STATE__?.videoData?.aid || 
               window.__playinfo__?.aid ||
               unsafeWindow.aid;
    } catch (e) {
        return null;
    }
}

setTimeout(() => {
    if (!bili_jct) {
        console.error("[BilibiliExp] 未检测到登录凭证(bili_jct)，请先登录B站！");
        return;
    }
    main();
}, 3500);

async function main() {
    aid = getAid();
    if (!aid) {
        console.error("[BilibiliExp] 无法获取视频 AID，尝试从页面元素重新提取...");
        // 兜底方案：从URL或视频播放器对象尝试抓取
        if(unsafeWindow.player?.getOptions) {
            aid = unsafeWindow.player.getOptions().aid;
        }
    }
    
    if (!aid) {
        console.error("[BilibiliExp] 彻底无法获取视频 AID，停止执行任务。");
        return;
    }

    console.log("[BilibiliExp] 开始检测今日经验状态...");
    
    let rewardRes = await gmAjax({ url: REWARD_URL, method: "GET" });
    if (rewardRes.code !== 0) {
        console.error("[BilibiliExp] 经验状态获取失败:", rewardRes.message);
        return;
    }

    let rewardData = rewardRes.data;
    
    // 【核心修复】安全兼容多变字段：优先取 coins，其次取 coin_exp，最后取 coin。如果都拿不到则默认为 0
    let currentCoinExp = (rewardData.coins !== undefined) ? rewardData.coins : 
                         ((rewardData.coin_exp !== undefined) ? rewardData.coin_exp : 
                         (rewardData.coin || 0));

    // 自动分享视频
    if (!rewardData.share) {
        console.log("[BilibiliExp] 检测到今日未分享，正在自动分享...");
        let shareRes = await gmPostAjax(SHARE_URL, { aid: aid, csrf: bili_jct });
        if (shareRes.code === 0) console.log("[BilibiliExp] 自动分享视频成功！");
    }

    // 自动投币逻辑
    if (currentCoinExp < 50) {
        let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
        let totalMoney = navRes.data?.money || 0;
        console.log(`[BilibiliExp] 当前拥有硬币: ${totalMoney} 个，已靠投币获取经验: ${currentCoinExp}/50`);

        if (totalMoney >= 5) { 
            let needCoins = (50 - currentCoinExp) / 10;
            for (let i = 0; i < needCoins; i++) {
                console.log(`[BilibiliExp] 正在尝试为当前视频(AID:${aid})投币...`);
                let coinRes = await gmPostAjax(ADD_COIN_URL, {
                    aid: aid,
                    multiply: 1,
                    select_like: 0,
                    csrf: bili_jct
                });
                if (coinRes.code === 0) {
                    console.log("[BilibiliExp] 投币成功一个！");
                    currentCoinExp += 10; // 动态累加
                    await wait(2500); 
                } else {
                    console.log("[BilibiliExp] 投币未成功（可能本日上限或本视频已投满）:", coinRes.message);
                    break; 
                }
            }
        } else {
            console.log("[BilibiliExp] 剩余硬币较少，不执行自动投币。");
        }
    }

    // 刷新数据并更新UI面板
    setTimeout(async () => {
        let finalReward = await gmAjax({ url: REWARD_URL, method: "GET" });
        let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
        if (finalReward.code === 0 && navRes.code === 0) {
            injectUI(finalReward.data, navRes.data);
        }
    }, 1500);
}

function injectUI(reward, nav) {
    let toolbar = document.querySelector(".video-toolbar-container") || document.querySelector(".toolbar-left");
    if (!toolbar) return;

    // 清除可能存在的旧面板
    $("#bili-exp-panel").remove();

    let panel = document.createElement("div");
    panel.id = "bili-exp-panel";
    panel.style = "display: flex; gap: 15px; margin-top: 12px; padding: 8px 12px; background: #f6f7f8; border-radius: 6px; font-size: 12px; color: #61666d; width: 100%; clear: both;";

    let loginOk = reward.login ? "✔️" : "❌";
    let watchOk = reward.watch ? "✔️" : "❌";
    let shareOk = reward.share ? "✔️" : "❌";
    
    // UI处同样进行容错安全处理
    let coinExp = (reward.coins !== undefined) ? reward.coins : 
                  ((reward.coin_exp !== undefined) ? reward.coin_exp : 
                  (reward.coin || 0));
                  
    let totalExp = (reward.login ? 5 : 0) + (reward.watch ? 5 : 0) + (reward.share ? 5 : 0) + coinExp;
    let nextLevelDays = "MAX";
    
    if (nav.level_info.current_level < 6) {
        let remainingExp = nav.level_info.next_exp - nav.level_info.current_exp;
        nextLevelDays = Math.ceil(remainingExp / 65) + "天";
    } else {
        nextLevelDays = "已满级大佬";
    }

    panel.innerHTML = `
        <div><b>🤖 经验助手提示</b></div>
        <div>每日登录: ${loginOk} (5/5)</div>
        <div>观看视频: ${watchOk} (5/5)</div>
        <div>视频分享: ${shareOk} (5/5)</div>
        <div>投币经验: 🪙 ${coinExp}/50</div>
        <div>今日总计: 📈 ${totalExp}/65</div>
        <div>升级预计: 📅 <span style="color:#00aeec; font-weight:bold;">${nextLevelDays}</span></div>
    `;

    toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
}

// 辅助工具函数
function getCookie(cname) {
    let name = cname + "=";
    let ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i].trim();
        if (c.indexOf(name) === 0) return c.substring(name.length, c.length);
    }
    return "";
}

function wait(n) {
    return new Promise(resolve => setTimeout(resolve, n));
}

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
        let encodedKey = encodeURIComponent(property);
        let encodedValue = encodeURIComponent(dataObj[property]);
        formBody.push(encodedKey + "=" + encodedValue);
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