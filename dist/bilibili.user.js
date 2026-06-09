// ==UserScript==
// @name         BilibiliExp - 2026终极24小时挂机守护版
// @namespace    BilibiliExp
// @match        *://www.bilibili.com/video/*
// @version      2.2.0
// @author       Dreace & Repairer
// @description  B 站经验助手：支持跨视频连投。只要当前视频网页不关闭，跨天自动在后台刷新并完成新一天的登录、分享、投币任务。
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
const RELATED_URL = "https://api.bilibili.com/x/web-interface/archive/related";

let aid = null;
let bili_jct = getCookie("bili_jct");
let lastRunDate = new Date().getDate(); // 记录初始化时的“号数”（如 9 号）
let isRunning = false; // 防并发锁

function getAid() {
    try {
        return unsafeWindow.__INITIAL_STATE__?.aid || 
               unsafeWindow.__INITIAL_STATE__?.videoData?.aid || 
               window.__playinfo__?.aid ||
               unsafeWindow.aid;
    } catch (e) { return null; }
}

// 首次打开页面，延迟3.5秒后执行第一次
setTimeout(() => {
    if (!bili_jct) {
        console.error("[BilibiliExp] 未检测到登录凭证，请先登录B站！");
        return;
    }
    runWorkflow();
    
    // 【核心注入：24小时跨天守护轮询】
    // 每隔 15 分钟触发一次检测，既不消耗系统资源，又能完美突破浏览器后台休眠
    setInterval(() => {
        let currentDate = new Date().getDate();
        console.log(`[BilibiliExp] 守护进程例行检查... 上次运行日期: ${lastRunDate}号, 当前日期: ${currentDate}号`);
        
        // 如果当前日期不等于上次运行日期（说明跨天了），或者日常经验之前没满，触发自动刷验
        if (currentDate !== lastRunDate) {
            console.log("[BilibiliExp] ⏰ 检测到新的一天已到来！启动新一天经验任务...");
            lastRunDate = currentDate; // 更新日期锚点
            runWorkflow();
        } else {
            // 如果没跨天，但想顺便静默刷新一下面板状态，可以执行以下：
            silentRefreshUI();
        }
    }, 15 * 60 * 1000); 

}, 3500);

// 工作流包装器，带并发锁
async function runWorkflow() {
    if (isRunning) return;
    isRunning = true;
    try {
        await main();
    } catch (err) {
        console.error("[BilibiliExp] 工作流运行中发生异常:", err);
    } finally {
        isRunning = false;
    }
}

async function main() {
    aid = getAid();
    if (!aid && unsafeWindow.player?.getOptions) {
        aid = unsafeWindow.player.getOptions().aid;
    }
    if (!aid) {
        console.error("[BilibiliExp] 无法获取视频 AID，挂机任务等待下次轮询。");
        return;
    }

    console.log("[BilibiliExp] 开始执行经验获取核心逻辑...");
    let rewardRes = await gmAjax({ url: REWARD_URL, method: "GET" });
    if (rewardRes.code !== 0) return;

    let rewardData = rewardRes.data;
    let currentCoinExp = (rewardData.coins !== undefined) ? rewardData.coins : 
                         ((rewardData.coin_exp !== undefined) ? rewardData.coin_exp : 
                         (rewardData.coin || 0));

    // 1. 自动网页分享
    if (!rewardData.share) {
        console.log("[BilibiliExp] 检测到今日未分享，正在自动分享当前视频...");
        await gmPostAjax(SHARE_URL, { aid: aid, csrf: bili_jct });
        await wait(1000);
    }

    // 2. 跨视频连投逻辑
    if (currentCoinExp < 50) {
        let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
        let totalMoney = navRes.data?.money || 0;
        console.log(`[BilibiliExp] 当前硬币余额: ${totalMoney}，已获投币经验: ${currentCoinExp}/50`);

        if (totalMoney >= 5) {
            // 尝试投当前主视频
            currentCoinExp = await coinLoopHandler(aid, currentCoinExp);

            // 如果当前视频投满但总经验还没满，抓取相关推荐视频流续投
            if (currentCoinExp < 50) {
                console.log("[BilibiliExp] 正在请求推荐视频流进行跨视频连投...");
                let relatedRes = await gmAjax({ url: `${RELATED_URL}?aid=${aid}`, method: "GET" });
                
                if (relatedRes.code === 0 && Array.isArray(relatedRes.data)) {
                    let videoPool = relatedRes.data.map(v => v.aid).filter(id => id && id !== aid);
                    for (let nextAid of videoPool) {
                        if (currentCoinExp >= 50) break;
                        console.log(`[BilibiliExp] 连投进行中 -> 目标 AID:${nextAid}`);
                        currentCoinExp = await coinLoopHandler(nextAid, currentCoinExp);
                        await wait(2500); 
                    }
                }
            }
        }
    }

    // 3. 渲染数据面板
    await silentRefreshUI();
}

// 核心投币处理器
async function coinLoopHandler(targetAid, expTracker) {
    let currentExp = expTracker;
    let maxTryPerVideo = 2; 
    
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
            console.log(`[BilibiliExp] 成功为 AID:${targetAid} 投币1枚！当前总投币经验: ${currentExp}/50`);
            await wait(2500); 
        } else {
            console.log(`[BilibiliExp] 视频(AID:${targetAid})提示: ${coinRes.message}`);
            break; 
        }
    }
    return currentExp;
}

// 纯净刷新并渲染UI的方法
async function silentRefreshUI() {
    let finalReward = await gmAjax({ url: REWARD_URL, method: "GET" });
    let navRes = await gmAjax({ url: NAV_URL, method: "GET" });
    if (finalReward.code === 0 && navRes.code === 0) {
        injectUI(finalReward.data, navRes.data);
    }
}

function injectUI(reward, nav) {
    let toolbar = document.querySelector(".video-toolbar-container") || document.querySelector(".toolbar-left");
    if (!toolbar) return;

    $("#bili-exp-panel").remove();

    let panel = document.createElement("div");
    panel.id = "bili-exp-panel";
    panel.style = "display: flex; flex-wrap: wrap; gap: 15px; margin-top: 12px; padding: 8px 12px; background: #edf4f9; border: 1px solid #d0e4f2; border-radius