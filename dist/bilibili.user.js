// ==UserScript==
// @name         BilibiliExp - 全域隐形挂机守护版 (终极跨域伪装版)
// @namespace    BilibiliExp
// @match        *://*.bilibili.com/*
// @noframes
// @version      3.2.3
// @author       Dreace & Repairer & Gemini
// @description  破解 B站 Referer 限制，强制伪装为主站请求。修复了投币逻辑缺陷与假完成判断。
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @run-at       document-end
// ==/UserScript==

"use strict";

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
    return `[${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}--${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}]`;
}

const log = (msg, ...args) => {
    console.log(`%c${getTimeStr()} ${msg}`, "color: #00a1d6; font-weight: bold;", ...args);
};

const err = (msg, ...args) => {
    console.error(`${getTimeStr()} ${msg}`, ...args);
};

function getExpInfo(li) {
    if (!li) return "[经验信息获取失败]";
    let curLv = li.current_level ?? "?";
    let curExp = li.current_exp ?? 0;
    let nextExp = li.next_exp;
    if (typeof nextExp === 'number' && nextExp > curExp) {
        return `[Lv.${curLv} | 经验: ${curExp}/${nextExp}, 升级还差: ${nextExp - curExp}]`;
    }
    return `[Lv.${curLv} | 经验: ${curExp} (已达最高等级)]`;
}

if (typeof GM_registerMenuCommand !== "undefined") {
    GM_registerMenuCommand("🔄 强制重置并运行任务", async () => {
        if (isRunning) return log("[BilibiliExp] ⚠️ 任务正在运行中，请勿重复点击。");
        log("[BilibiliExp] 🔄 收到手动重置指令...");
        await GM.setValue("BiliExp_LastDate", "");
        await GM.setValue("BiliExp_Lock", 0);
        await tryExecuteWorkflow();
    });
}

(async function() {
    log(`[BilibiliExp] 脚本已启动，正在初始化底层伪装引擎...`);
    if (window.top !== window.self) return;

    const curUrl = window.location.href;
    if (curUrl.includes("passport.bilibili.com")) return;

    setInterval(async () => {
        await tryExecuteWorkflow();
    }, 240 * 60 * 1000);

    setTimeout(async () => {
        await tryExecuteWorkflow();
    }, 5000);
})();

async function tryExecuteWorkflow() {
    if (isRunning) return; 
    isRunning = true;
    
    try {
        let currentDateStr = new Date().toDateString(); 
        let lastRunDate = await GM.getValue("BiliExp_LastDate", "");
        
        bili_jct = getCookie("bili_jct");
        if (!bili_jct) {
            log("[BilibiliExp] 未能在当前页面检测到 Cookie 凭证，请确保已登录B站。");
            return;
        }

        let navRes = await requestAPI(NAV_URL, "GET");
        if (navRes.code !== 0 || !navRes.data?.isLogin) {
            log("[BilibiliExp] 接口读取失败或未登录，请检查登录状态。");
            return;
        }

        let levelInfo = navRes.data.level_info;
        log(`[BilibiliExp] 👤 登录验证成功！当前用户: ${navRes.data.uname || "未知"} ${getExpInfo(levelInfo)}`);
        log(`[BilibiliExp] 守护线程触发检测。今日状态: ${lastRunDate === currentDateStr ? "✅ 已完成" : "⏳ 待执行"}`);

        if (lastRunDate === currentDateStr) return;

        let lockTime = await GM.getValue("BiliExp_Lock", 0);
        if (Date.now() - lockTime < 5 * 60 * 1000) {
            log("[BilibiliExp] 别的标签页正在执行，本页面跳过。");
            return; 
        }
        
        await GM.setValue("BiliExp_Lock", Date.now());
        await startHiddenTask(currentDateStr, levelInfo);
        
    } finally {
        isRunning = false;
        await GM.setValue("BiliExp_Lock", 0);
    }
}

async function startHiddenTask(currentDateStr, levelInfo) {
    try {
        let rewardRes = await requestAPI(REWARD_URL, "GET");
        if (rewardRes.code !== 0) return;

        let rewardData = rewardRes.data;
        let coinExp = (rewardData.coins !== undefined) ? rewardData.coins : (rewardData.coin_exp || 0);
        let hasWatched = (rewardData.watch !== undefined) ? rewardData.watch : (rewardData.watch_av || false);

        if (rewardData.login && hasWatched && rewardData.share && coinExp >= 50) {
            log(`[BilibiliExp] 🎉 检测到今日所有经验已满！标记今日任务完成。当前状态: ${getExpInfo(levelInfo)}`);
            await GM.setValue("BiliExp_LastDate", currentDateStr);
            return;
        }

        let hotRes = await requestAPI(HOT_VIDEO_URL, "GET");
        if (hotRes.code !== 0 || !Array.isArray(hotRes.data?.list)) {
            log("[BilibiliExp] 无法获取B站热门视频池，放弃本次执行。");
            return;
        }
        
        let videoPool = hotRes.data.list.map(v => ({
            aid: v.aid,
            bvid: v.bvid,
            cid: v.cid
        })).filter(v => v.aid && v.cid && v.bvid);

        if (videoPool.length === 0) return;
        let randomVideo = videoPool[Math.floor(Math.random() * videoPool.length)];

        // 0. 模拟观看视频
        if (!hasWatched) {
            log(`[BilibiliExp] 后台正在隐形观看视频(BVID:${randomVideo.bvid})...`);
            let watchRes = await requestAPI(HEARTBEAT_URL, "POST", {
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
            });
            log(`[BilibiliExp] 观看请求结果:`, watchRes.code === 0 ? "成功" : watchRes);
            await wait(3000);
        }

        // 1. 模拟分享
        if (!rewardData.share) {
            log(`[BilibiliExp] 后台正在隐形分享视频(BVID:${randomVideo.bvid})...`);
            let shareRes = await requestAPI(SHARE_URL, "POST", { 
                aid: randomVideo.aid, 
                bvid: randomVideo.bvid, 
                csrf: bili_jct 
            });
            log(`[BilibiliExp] 分享请求结果:`, shareRes.code === 0 ? "成功" : shareRes);
            await wait(3000);
        }

        // 2. 模拟投币 (修复的核心逻辑)
        let expectedCoinExp = coinExp; 
        if (coinExp < 50) {
            let totalMoney = (await requestAPI(NAV_URL, "GET")).data?.money || 0;
            let needExp = 50 - coinExp;
            let needCoins = needExp / 10;
            let availableCoins = Math.floor(totalMoney);

            if (availableCoins >= 1 && needCoins > 0) {
                let tossCount = Math.min(needCoins, availableCoins);
                log(`[BilibiliExp] 投币经验未满(差${needExp}点)，硬币余额: ${totalMoney}。准备后台连投 ${tossCount} 枚...`);

                let successCount = 0;
                for (let targetVideo of videoPool) {
                    if (successCount >= tossCount) break;

                    let coinRes = await requestAPI(ADD_COIN_URL, "POST", {
                        aid: targetVideo.aid, 
                        bvid: targetVideo.bvid, // 增加 BVID 传参，提高兼容性
                        multiply: 1, 
                        select_like: 0, 
                        csrf: bili_jct
                    });

                    if (coinRes.code === 0) {
                        successCount++;
                        expectedCoinExp += 10;
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
            } else if (availableCoins < 1) {
                log(`[BilibiliExp] 硬币余额不足(${totalMoney})，跳过投币任务。`);
            }
        } else {
            expectedCoinExp = 50;
        }

        // 3. 最终轮询校验机制 (加入经验校验闭环)
        log("[BilibiliExp] 正在等待B站服务器刷新数据凭证...");
        let isAllDone = false;
        
        for (let i = 1; i <= 3; i++) {
            await wait(4000 * i); 
            let finalReward = await requestAPI(REWARD_URL, "GET");
            
            if (finalReward.code === 0) {
                let fData = finalReward.data;
                let fCoinExp = (fData.coins !== undefined) ? fData.coins : (fData.coin_exp || 0);
                let fWatched = (fData.watch !== undefined) ? fData.watch : (fData.watch_av || false);
                
                log(`[BilibiliExp] 第 ${i} 次经验结算核对: 登录[${fData.login}] 观看[${fWatched}] 分享[${fData.share}] 投币已获EXP[${fCoinExp}] (目标:${expectedCoinExp})`);
                
                // 【核心修复】：必须满足观看、分享、登录，并且经验值达到了期望值才算完成
                if (fData.login && fWatched && fData.share && fCoinExp >= expectedCoinExp) {
                    isAllDone = true;
                    break;
                }
            }
        }

        if (isAllDone) {
            let finalNav = await requestAPI(NAV_URL, "GET");
            let finalLevelInfo = finalNav.code === 0 ? finalNav.data?.level_info : null;

            log(`[BilibiliExp] 🎉 经验核对成功，全部任务已确认写入服务器。最新进度: ${getExpInfo(finalLevelInfo || levelInfo)}`);
            await GM.setValue("BiliExp_LastDate", currentDateStr);
        } else {
            log("[BilibiliExp] ⚠️ 任务结算遇到延迟或未达标。本次暂不标记完成，下次后台刷新时将自动重试漏掉的进度。");
        }

    } catch (e) {
        err("[BilibiliExp] 隐形守护线程发生致命错误", e);
    } finally {
        await GM.setValue("BiliExp_Lock", 0);
    }
}

function requestAPI(url, method = "GET", dataObj = null) {
    return new Promise((resolve) => {
        let headers = {
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.bilibili.com", 
            "Referer": "https://www.bilibili.com/" 
        };
        let body = null;

        if (method === "POST" && dataObj) {
            headers["Content-Type"] = "application/x-www-form-urlencoded";
            let formBody = [];
            for (let property in dataObj) {
                formBody.push(encodeURIComponent(property) + "=" + encodeURIComponent(dataObj[property]));
            }
            body = formBody.join("&");
        }

        let reqUrl = url;
        if (method === "GET") {
            reqUrl += (reqUrl.includes('?') ? '&' : '?') + "_t=" + Date.now();
        }

        GM_xmlhttpRequest({
            method: method,
            url: reqUrl,
            headers: headers,
            data: body,
            withCredentials: true,
            onload: function(res) {
                try {
                    resolve(JSON.parse(res.responseText));
                } catch (e) {
                    resolve({ code: -1, msg: "JSON解析失败" });
                }
            },
            onerror: function() {
                resolve({ code: -1, msg: "网络请求失败" });
            }
        });
    });
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