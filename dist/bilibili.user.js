// ==UserScript==
// @name         BilibiliExp - 全域隐形挂机守护版 (无需开B站)
// @namespace    BilibiliExp
// @match        *://*/*
// @version      3.0.0
// @author       Dreace & Repairer
// @description  真正的全自动化：任何网页后台都能运行，自动随机抓取B站热门视频完成每日登录、分享、投币任务。带全局唯一锁，防多开风控。
// @grant        GM.xmlHttpRequest
// @grant        GM.setValue
// @grant        GM.getValue
// @run-at       document-end
// ==/UserScript==

"use strict";

const NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const REWARD_URL = "https://api.bilibili.com/x/member/web/exp/reward";
const ADD_COIN_URL = "https://api.bilibili.com/x/web-interface/coin/add";
const SHARE_URL = "https://api.bilibili.com/x/web-interface/share/add";
const HOT_VIDEO_URL = "https://api.bilibili.com/x/web-interface/popular?ps=20&pn=1"; // 热门视频流接口，用于随机抓取aid

let bili_jct = "";

// 异步初始化
(async function() {
    // 排除一些绝对不需要运行的敏感或特定页面（如流媒体播放、银行等，可自行优化）
    if (window.location.href.includes("netflix") || window.location.href.includes("youtube")) return;

    // 每一小时，全浏览器所有打开的标签页中，随机选择一个幸运儿来执行任务
    setInterval(async () => {
        await tryExecuteWorkflow();
    }, 15 * 60 * 1000); // 每15分钟例行检查一次

    // 打开网页 5 秒后，首次尝试执行
    setTimeout(async () => {
        await tryExecuteWorkflow();
    }, 5000);
})();

// 核心控制：利用油猴全局缓存，确保多标签页下只有“一个实例”在工作，防止并发封号
async function tryExecuteWorkflow() {
    let currentDateStr = new Date().toDateString(); // 例如 "Tue Jun 09 2026"
    let lastRunDate = await GM.getValue("BiliExp_LastDate", "");
    
    // 如果今天已经成功刷完了，直接退出，不干扰用户正常上网
    if (lastRunDate === currentDateStr) {
        return; 
    }

    // 抢占全局执行锁 (有效期3分钟，防止某个标签页死锁后其他标签页无法接管)
    let lockTime = await GM.getValue("BiliExp_Lock", 0);
    if (Date.now() - lockTime < 3 * 60 * 1000) {
        return; // 别的标签页正在刷，本页面退出
    }
    
    // 成功抢锁
    await GM.setValue("BiliExp_Lock", Date.now());
    console.log("[BilibiliExp] 成功抢占全局挂机锁，开始在后台静默检测B站经验...");

    // 检查B站登录状态并获取 CSRF (jct)
    let navRes = await gmAjax(NAV_URL);
    if (navRes.code !== 0 || !navRes.data.isLogin) {
        console.log("[BilibiliExp] 监测到你未登录B站，或当前网页无法读取B站凭证。等待下次机会。");
        await GM.setValue("BiliExp_Lock", 0); // 释放锁
        return;
    }

    bili_jct = getBiliJctFromCookie(navRes.cookieRaw);
    if (!bili_jct) {
        console.log("[BilibiliExp] 未能在Cookie中截获 bili_jct，跳过。");
        await GM.setValue("BiliExp_Lock", 0);
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

        // 如果今天全部拉满了，提前收工
        if (rewardData.login && rewardData.share && coinExp >= 50) {
            console.log("[BilibiliExp] 🎉 检测到今日所有经验已满！标记今日任务完成。");
            await GM.setValue("BiliExp_LastDate", currentDateStr);
            return;
        }

        // 既然需要干活，先去抓一包B站当下的热门视频作为素材池
        let hotRes = await gmAjax(HOT_VIDEO_URL);
        if (hotRes.code !== 0 || !Array.isArray(hotRes.data?.list)) {
            console.log("[BilibiliExp] 无法获取B站热门视频池，放弃本次执行。");
            return;
        }
        let videoPool = hotRes.data.list.map(v => v.aid).filter(id => id);

        if (videoPool.length === 0) return;
        let randomAid = videoPool[Math.floor(Math.random() * videoPool.length)];

        // 1. 模拟分享
        if (!rewardData.share) {
            console.log(`[BilibiliExp] 后台正在隐形分享视频(AID:${randomAid})...`);
            await gmPostAjax(SHARE_URL, { aid: randomAid, csrf: bili_jct });
            await wait(2000);
        }

        // 2. 模拟投币
        if (coinExp < 50) {
            let totalMoney = (await gmAjax(NAV_URL)).data?.money || 0;
            if (totalMoney >= 5) {
                let needExp = 50 - coinExp;
                console.log(`[BilibiliExp] 投币经验未满，硬币余额: ${totalMoney}。开始跨视频后台连投...`);

                for (let targetAid of videoPool) {
                    if (needExp <= 0) break;

                    // 每个视频最多投1个，最大化通过率，防撞上限
                    let coinRes = await gmPostAjax(ADD_COIN_URL, {
                        aid: targetAid, multiply: 1, select_like: 0, csrf: bili_jct
                    });

                    if (coinRes.code === 0) {
                        needExp -= 10;
                        console.log(`[BilibiliExp] 后台成功为视频(AID:${targetAid})隐形投币1枚。`);
                        await wait(3000); // 温和间隔
                    } else {
                        // 遇到投满的或者不允许投的，直接切下一个
                        await wait(1000);
                    }
                }
            }
        }

        // 最终校验
        let finalCheck = await gmAjax(REWARD_URL);
        let finalCoinExp = (finalCheck.data?.coins !== undefined) ? finalCheck.data.coins : (finalCheck.data?.coin_exp || 0);
        if (finalCheck.data?.login && finalCheck.data?.share && finalCheck.data?.watch && finalCheck.coinExp >= 50) {
            await GM.setValue("BiliExp_LastDate", currentDateStr);
            console.log("[BilibiliExp] 今日挂机任务已完美全自动化达成！");
        }

    } catch (e) {
        console.error("[BilibiliExp] 隐形守护线程发生致命错误", e);
    } finally {
        // 释放锁，给其他页面或者下一次轮询机会
        await GM.setValue("BiliExp_Lock", 0);
    }
}

// 跨域异步网络请求器
function gmAjax(url) {
    return new Promise((resolve) => {
        GM.xmlHttpRequest({
            method: "GET",
            url: url,
            // 关键：匿名模式设为false，强制Tampermonkey跨域底层自动抽取保存的B站Cookie
            withCredentials: true, 
            headers: {
                "Referer": "https://www.bilibili.com/",
                "User-Agent": navigator.userAgent
            },
            onload: (res) => {
                let obj = JSON.parse(res.responseText);
                // 把底层获取到的真实 header cookie 带出来用以解析 csrf
                obj.cookieRaw = res.responseHeaders; 
                resolve(obj);
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
            onload: (res) => resolve(JSON.parse(res.responseText)),
            onerror: () => resolve({ code: -1 })
        });
    });
}

// 从系统环境中安全提取B站的csrf凭证
function getBiliJctFromCookie(headersStr) {
    // 优先从当前浏览器已存的本地cookie里捞
    let inlineJct = getCookie("bili_jct");
    if (inlineJct) return inlineJct;
    
    // 如果由于跨域拿不到，尝试从GM请求返回的 Set-Cookie 头部强行截取
    if (!headersStr) return "";
    let match = headersStr.match(/bili_jct=([a-f0-9]{32})/);
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