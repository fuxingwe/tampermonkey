// ==UserScript==
// @name         BilibiliExp - 全域隐形挂机守护版 (需开B站页面)
// @namespace    BilibiliExp
// @match        *://*.bilibili.com/*
// @noframes
// @version      3.1.5
// @author       Dreace & Repairer & Gemini
// @description  真正的全自动化：防劫持日志穿透版。自动随机抓取B站热门视频完成任务。
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

// 日志时间戳格式化工具
function getTimeStr() {
    let now = new Date();
    let y = now.getFullYear();
    let m = String(now.getMonth() + 1).padStart(2, '0');
    let d = String(now.getDate()).padStart(2, '0');
    let h = String(now.getHours()).padStart(2, '0');
    let min = String(now.getMinutes()).padStart(2, '0');
    let s = String(now.getSeconds()).padStart(2, '0');
    return `[${y}-${m}-${d} ${h}:${min}:${s}]`;
}

// 全局日志劫持封装（核心修改：单字符串拼接 + CSS高亮穿透）
const log = (msg, ...args) => {
    if (args.length > 0) {
        console.log(`%c${getTimeStr()} ${msg}`, "color: #00a1d6; font-weight: bold;", ...args);
    } else {
        console.log(`%c${getTimeStr()} ${msg}`, "color: #00a1d6; font-weight: bold;");
    }
};
const err = (msg, ...args) => {
    console.error(`${getTimeStr()} ${msg}`, ...args);
};

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

// 核心控制
async function tryExecuteWorkflow() {
    let currentDateStr = new Date().toDateString(); 
    let lastRunDate = await GM.getValue("BiliExp_LastDate", "");
    
    log(`[BilibiliExp] 隐形守护线程触发检测。今日状态: ${lastRunDate === currentDateStr ? "✅ 已完成" : "⏳ 待执行"}`);

    // 如果今天已经成功刷完了，直接退出
    if (lastRunDate === currentDateStr) {
        return; 
    }

    // 抢占全局执行锁 (有效期5分钟)
    let lockTime = await GM.getValue("BiliExp_Lock", 0);
    if (Date.now() - lockTime < 5 * 60 * 1000) {
        log("[BilibiliExp] 别的标签页正在执行任务，本页面静默。");
        return; 
    }
    
    // 成功抢锁
    await GM.setValue("BiliExp_Lock", Date.now());
    log("[BilibiliExp] 🚀 成功抢占全局挂机锁，开始在后台静默检测B站经验...");

    // 检查B站登录状态
    let navRes = await gmAjax(NAV_URL);
    if (navRes.code !== 0 || !navRes.data?.isLogin) {
        log("[BilibiliExp] 监测到你未登录B站，或当前网页由于跨域安全限制无法读取凭证。30分钟内不再重试。");
        await GM.setValue("BiliExp_Lock", Date.now() + 25 * 60 * 1000); 
        return;
    }

    // 尝试获取 CSRF
    bili_jct = getBiliJctFromCookie(navRes.cookieRaw);
    if (!bili_jct) {
        log("[BilibiliExp] 未能在Cookie中截获 bili_jct，300分钟内跳过。");
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
        
        // 打印最终战果供控制台参考
        await wait(2000);
        let finalReward = await gmAjax(REWARD_URL);
        if(finalReward.code === 0) {
            log(`[BilibiliExp] 今日最终经验结算: 登录[${finalReward.data.login}] 观看[${finalReward.data.watch}] 分享[${finalReward.data.share}] 投币已获EXP[${finalReward.data.coins}]`);
        }

    } catch (e) {
        err("[BilibiliExp] 隐形守护线程发生致命错误", e);
    } finally {
        // 释放锁
        await GM.setValue("BiliExp_Lock", 0);
    }
}

// 跨域异步网络请求器 (已加入强制破除缓存机制)
function gmAjax(url) {
    // 强制追加时间戳，防止浏览器对GET请求的死缓存，确保每次都能真实触达B站服务器激活登录经验
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

// POST请求器 (支持动态传入 Referer 以应对B站风控)
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
                // 使用动态传入的具体视频页URL作为Referer，而非根目录
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