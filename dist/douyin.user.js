// ==UserScript==
// @name                douyin_tools
// @namespace           https://feng.fx.com/
// @version             0.1.1
// @description         douyin_tools useful
// @author              feng
// @copyright           feng
// @license             MIT
// @match               *://live.douyin.com/*
// @run-at              document-idle
// @supportURL          https://baidu.com
// @homepage            https://baidu.com
// @grant               GM_setClipboard
// @icon                https://nav.programnotes.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=48&url=https://douyin.com
// ==/UserScript==

//设置插件允许访问文件网址然后通过下面两句直接浏览器中引用文件调试   // @match */*    和   // @require file://D:/dist/douyin.user.js

(async function () {
    console.log('douyin tools start');
    if (location.href.includes('//live.douyin.com/')) {
        let page = document.getElementsByTagName('body')[0];
        console.log('page', page);
        let autoDianZhanBtn = document.createElement('p');
        autoDianZhanBtn.className = 'autoDianZhanBtn';
        autoDianZhanBtn.innerHTML = '开始<br/>点赞';
        page.append(autoDianZhanBtn);
        let total = document.createElement('div');
        total.className = 'total';
        total.innerHTML = '<p class="text">点赞数：</p><p class="autoDianZhanBtn-all">0</p>';
        page.append(total);

        let num = document.getElementsByClassName('autoDianZhanBtn-all')[0];
        console.log('num', num);
        num.innerHTML = 0;
        let isStarted = false;

        const a = document.createEvent('MouseEvents');
        a.clientX = 100;
        a.clientY = 100;
        a.initEvent('click', true, true);
        let clickEle = null;
        // 设置点赞间隔，最好是0.6秒一次，不然会提示手速太快,目前一小时总共可以3000次？
        // 标签切到后台5分钟后setInterval方法的频率变为一分钟一次，这是浏览器的底层节能策略导致的
        let interval = 1200;
        autoDianZhanBtn.addEventListener('click', () => {
            isStarted = !isStarted;
            if (!isStarted) {
                window.dzanTimer && workerTimer.clearInterval(window.dzanTimer);
                autoDianZhanBtn.innerHTML = '开始<br/>点赞';
                return;
            }
            console.log('执行点赞脚本');
            autoDianZhanBtn.innerHTML = '停止<br/>点赞';
            let count = 0;
            window.dzanTimer && workerTimer.clearInterval(window.dzanTimer);
            window.dzanTimer = workerTimer.setInterval(async () => {
                if (clickEle == null) {
                    if (clickEle == null) {
                        clickEle = document.querySelector('.LO5TGkc0');
                    }
                    if (clickEle == null) {
                        clickEle = document.querySelector('.PPcGIai7');
                    }
                    if (clickEle == null) {
                        num.innerHTML = 'waiting for clickEle';
                        console.log('waiting for clickEle');
                        return;
                    }
                }
                if (document.body.textContent.includes('手速太快了')) {
                    console.log('提示手速太快了，暂停一会');
                    await sleep(100000);
                    return;
                }
                if (document.body.textContent.includes('直播已结束')) {
                    console.log('提示直播已结束，暂停一段时间');
                    await sleep(3600000);
                    return;
                }
                clickEle?.dispatchEvent(a);
                await sleep(100);
                clickEle?.dispatchEvent(a);
                console.log(new Date().toLocaleString() + ' 点赞+' + ++count);
                num.innerHTML = count;
                // setTimeout(() => {
                //     //双击
                //     clickEle?.dispatchEvent(a);
                //     console.log(new Date().toLocaleString() + ' 点赞+' + ++count);
                //     num.innerHTML = count;
                // }, 100);
                if (count >= 3000) {
                    interval = 1400;
                    await sleep(300);
                }
            }, interval);
        });
        // }
    }
})();

/**
 * 实现sleep函数（js自身没有sleep函数）
 */
function sleep(time) {
    // return new Promise((resolve) => setTimeout(resolve, time));
    //不使用setTimeout，因为浏览器页面进入后台后setTimeout的延迟时间不对，浏览器节能导致 https://blog.csdn.net/L435204/article/details/137959410
    return new Promise((resolve) => {
        let funtemp = function (time) {
            setTimeout(function () {
                self.postMessage(0);
            }, time);
        };
        let worker = new Worker(window.URL.createObjectURL(new Blob(['(' + funtemp.toString() + ')(' + time + ')'])));
        worker.onmessage = function () {
            worker.terminate();
            resolve();
        };
    });
}

//web worker实现setInterval
//https://www.jianshu.com/p/99535d3b7fd7
// Build a worker from an anonymous function body
const blobURL = URL.createObjectURL(
    new Blob(
        [
            '(',

            function () {
                const intervalIds = {};
                let intervalId = null;

                // 监听message 开始执行定时器或者销毁
                self.onmessage = function onMsgFunc(e) {
                    switch (e.data.command) {
                        case 'interval:start': // 开启定时器
                            intervalId = setInterval(function () {
                                postMessage({
                                    message: 'interval:tick',
                                    id: e.data.id,
                                });
                            }, e.data.interval);

                            postMessage({
                                message: 'interval:started',
                                id: e.data.id,
                            });

                            intervalIds[e.data.id] = intervalId;
                            break;
                        case 'interval:clear': // 销毁
                            clearInterval(intervalIds[e.data.id]);

                            postMessage({
                                message: 'interval:cleared',
                                id: e.data.id,
                            });

                            delete intervalIds[e.data.id];
                            break;
                    }
                };
            }.toString(),

            ')()',
        ],
        { type: 'application/javascript' }
    )
);

const worker = new Worker(blobURL);

URL.revokeObjectURL(blobURL);

const workerTimer = {
    id: 0,
    callbacks: {},
    setInterval: function (cb, interval, context) {
        this.id++;
        const id = this.id;
        this.callbacks[id] = { fn: cb, context: context };
        worker.postMessage({
            command: 'interval:start',
            interval: interval,
            id: id,
        });
        return id;
    },
    setTimeout: function (cb, timeout, context) {
        this.id++;
        const id = this.id;
        this.callbacks[id] = { fn: cb, context: context };
        worker.postMessage({ command: 'timeout:start', timeout: timeout, id: id });
        return id;
    },

    // 监听worker 里面的定时器发送的message 然后执行回调函数
    onMessage: function (e) {
        switch (e.data.message) {
            case 'interval:tick':
            case 'timeout:tick': {
                const callbackItem = this.callbacks[e.data.id];
                if (callbackItem && callbackItem.fn) callbackItem.fn.apply(callbackItem.context);
                break;
            }

            case 'interval:cleared':
            case 'timeout:cleared':
                delete this.callbacks[e.data.id];
                break;
        }
    },

    // 往worker里面发送销毁指令
    clearInterval: function (id) {
        worker.postMessage({ command: 'interval:clear', id: id });
    },
    clearTimeout: function (id) {
        worker.postMessage({ command: 'timeout:clear', id: id });
    },
};

worker.onmessage = workerTimer.onMessage.bind(workerTimer);

function getURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const params = {};
    for (const [key, value] of urlParams) {
        params[key] = value;
    }

    return params;
}

//抖音直播自动点赞按钮添加样式
function addGlobalStyle(css) {
    var head, style;
    head = document.getElementsByTagName('head')[0];
    if (!head) {
        return;
    }
    style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;
    head.appendChild(style);
}

addGlobalStyle(
    `.autoDianZhanBtn {
        content: '';
        font-size: 14px;
        position: fixed;
        top: 70px;right: 30px;
        z-index: 500;
        cursor: pointer;
        background: #3eaf7c;
        border-radius: 50%;
        color: #ff0;
        display: block;
        width: 46px;height: 46px;
        line-height: 16px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all ease 0.3s;

    }
    .autoDianZhanBtn:hover {
        background-color: #4abf8a;
        transform: rotate(360deg)
    }


    .total {
        font-size: 14px;
        position: fixed;
        top: 79px;
        right: 85px;
        z-index: 500;
        background: #3eaf7c;
        color: #ff0;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all ease 0.3s;
        padding: 5px 8px;
        border-radius: 20px;

    }
    .total p {
        color:#ff0;
    }

    `
);
