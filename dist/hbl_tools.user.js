/* eslint-disable no-undef */
// ==UserScript==
// @name                hbl_tools
// @namespace           https://github.com/fengxing/fbl_tools
// @version             0.1.3
// @description         hbl_tools useful
// @author              fengxing
// @copyright           fengxing
// @license             MIT
// @match               *://*.aplum.com/mis/*
// @run-at              document-idle
// @supportURL          https://baidu.com
// @homepage            https://baidu.com
// @require             https://cdn.bootcdn.net/ajax/libs/exceljs/4.3.0/exceljs.min.js
// @require             https://cdn.bootcdn.net/ajax/libs/FileSaver.js/2.0.5/FileSaver.js
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_setClipboard
// @icon                data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAttJREFUaEPtWVtSAjEQTKC0vISUn3IK8WTAycBT6KeFl7C0JFZGg9mQTPcsiyUqn5qdpLvnlYl3J/7zJ35+9/cA3E/OF965uSgXwjqMx8vp4/O6j5JiK4Qb5/0s2oo2rp9eby22aAXury5mfrtd1YwH55bTzcvCsnGHiOLD680LfS564cPl2UqYavwsIDQyRFgDITyAyXlQGf50J0YF//Y218gQVyJVoAAgxphDW9eE0eiWiS0KQNz8ASlgPSFYP6gCcS8t6FJGMmFQ4ilmJDYb0QogFVjGEkhNUdZ9oq3BAFgyB8poFjJoAKULxU1qf0NuVCaExHauiIUMCkBr09KtmI077Ge+3ocM2oVam9aCW5NfI6K0xZBBAUCbWlTIiagdsFSBAQFdSGM/+fteio1V2fu7Mh52TaBSaa2upAKwGEOZJQeDmLUEtArAYmhIABbiOgDih4mpXZ8u7aFeGfv0ShYV5N6RXHI0Wuc9kgBAbQKqjBb2c1dSM1Z+caoUl3QmD9lD7IONtMKGVGCI9ZC9RkbZuVq6XqIS3Pq/Yr/jxjUVnFv6726T++JsfXfaAEJY7zVke0gPkJhhO8ZBk900sVDcDwbxoYF2SBCj+IyZ6CONKiMTKQNgStArjlB2I8/ULWRXFzO33cropMwAh+Tsmgqm2oIKWUtmSyuBcnZnD8R+UVs08n53Mye9fjaRa8XC3p2hkllYl2Ta91xNeB9gLhnspsglmctT5Y6Bs3U5kc5nNpZNUZvMEmFSIC1usce4WL5hDiJ3SQsRvQAcbazyWWOQezWrNXagrxXqNM0wEkcp9ziDLVAZLZtKdlOGxRZbMAvtYgA8cKQnIlrRgR5LeACnPF5HzR7NumEh6pWSqeEU+MlPTNJyk1MChmRkC41xetWBsi/KjaD7Qg2UBoJ1H2n7GcbyNVJ55cuPx+k4cLK+ESd7ElvZi2UfIswArICPvf4fwLEZRvbfAT8jlbXobXLcAAAAAElFTkSuQmCC
// ==/UserScript==

let dbName = 'productsDB';
let storeName = 'productsSelectedStore';
let productsCachedStoreName = 'productsCachedStore';
let db;

(async function () {
    console.log('hbl_tools start');
    let enable = checkEnable();
    if (!enable) {
        console.log('checkEnable is false');
        return;
    }
    let pathname = location.pathname;
    console.log(pathname);
    processBorrowTip();

    if (pathname.endsWith('/activity-new/view-douyin-live')) {
        let vue2App = document.getElementById('vue2-app').__vue__;
        //处理底部按钮，并设置为自适应换行
        let group = document.getElementsByClassName('view-shop-footer')[0];
        group.style.justifyContent = 'flex-start';
        group.style.display = 'flex';
        group.style.flexWrap = 'wrap';

        let btn = document.createElement('button');
        btn.textContent = '批量复制ID';
        btn.className = 'el-button el-button--primary el-button--mini';
        btn.style.background = 'green';
        group.appendChild(btn);
        btn.addEventListener('click', () => {
            if (!vue2App.checkSelectProduct()) {
                return;
            }
            let selectedProducts = vue2App.selectedProducts;
            let selectedPids = selectedProducts.map((t) => t.p_id);
            let copyStr = selectedPids.join('\n');
            GM_setClipboard(copyStr);
            vue2App.$message({
                type: 'success',
                message: '复制成功，粘贴即可，' + copyStr,
            });
        });

        let deleteBtn = btn.cloneNode(true);
        deleteBtn.textContent = '批量删除(支持删借出)';
        group.appendChild(deleteBtn);
        deleteBtn.addEventListener('click', () => {
            if (!vue2App.checkSelectProduct()) {
                return;
            }
            vue2App
                .$confirm('确认要删除商品吗?', '提示', {
                    confirmButtonText: '确定',
                    cancelButtonText: '取消',
                    type: 'warning',
                })
                .then(() => {
                    let selectedProducts = vue2App.selectedProducts;
                    let waitTime = 0;
                    for (let i = 0; i < selectedProducts.length; i++) {
                        if (selectedProducts[i].enable_delete === 0) {
                            tryDeleteBorrowedProduct(vue2App, selectedProducts[i].p_id);
                            waitTime = 2000;
                        }
                    }

                    //延迟调用活动页删除
                    setTimeout(() => {
                        vue2App
                            .ajax('post', '/mis/activity/batch-delete-product', {
                                ids: vue2App.selectedProducts.map((t) => t.id),
                            })
                            .then((res) => {
                                if (res.success) {
                                    vue2App.$message({
                                        type: 'success',
                                        message: '删除成功',
                                    });
                                    vue2App.updateCardData();
                                } else {
                                    vue2App.$message({
                                        type: 'error',
                                        message: res.message,
                                    });
                                }
                            });
                    }, waitTime);
                });
        });

        let tipStr = '(包括缓存)';
        let exportButton1 = btn.cloneNode(true);
        exportButton1.textContent = '批量导出' + tipStr + '(附1张图)';
        group.appendChild(exportButton1);
        exportButton1.addEventListener('click', async () => {
            await exportProducts2Excel(vue2App, 1);
        });
        let exportButton = btn.cloneNode(true);
        exportButton.textContent = '批量导出' + tipStr + '(附3张图)';
        group.appendChild(exportButton);
        exportButton.addEventListener('click', async () => {
            await exportProducts2Excel(vue2App, 3);
        });
        exportButton = btn.cloneNode(true);
        exportButton.textContent = '批量导出' + tipStr + '(附所有图)';
        group.appendChild(exportButton);
        exportButton.addEventListener('click', async () => {
            await exportProducts2Excel(vue2App, 7);
        });
        //活动页indexDB相关操作，处理缓存逻辑
        db = await openDB(dbName, 1);
        console.log('openDB success:' + dbName);
        await deleteOldCachedProducts(productsCachedStoreName);

        let tempBtn = btn.cloneNode(true);
        tempBtn.textContent = '清空缓存';
        group.insertBefore(tempBtn, exportButton1);
        tempBtn.addEventListener('click', async () => {
            await deleteDBStore(db, storeName);
            vue2App.$message({
                type: 'success',
                message: '清空缓存成功',
            });
        });

        tempBtn = btn.cloneNode(true);
        tempBtn.textContent = '存入缓存';
        group.insertBefore(tempBtn, exportButton1);
        tempBtn.addEventListener('click', async () => {
            await deleteOldCachedProducts(storeName);
            if (!vue2App.checkSelectProduct()) {
                return;
            }
            var products = await cursorGetData(db, storeName);
            vue2App.selectedProducts.forEach((t) => {
                if (products != null && products.some((item) => item.p_id === t.p_id)) {
                    console.log('缓存中已有该商品，跳过' + t.p_id);
                } else {
                    t.cacheTimeStamp = new Date().getTime();
                    updateDB(db, storeName, t);
                }
            });
            vue2App.$message({
                type: 'success',
                message: '存入缓存成功:' + vue2App.selectedProducts.map((t) => t.p_id).join(','),
            });
        });

        let lasProductsCount = 0;
        let needRequestPrice = false;
        let faSheBtnProcessed = false;
        let cachedProductsMap = {};
        //获取缓存数据
        var products = await cursorGetData(db, productsCachedStoreName);
        for (let index = 0; index < products?.length; index++) {
            let t = products[index];
            cachedProductsMap[t.p_id] = t;
        }
        //定时执行，补充商品信息，因为可能通过搜索来刷新数据
        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (vue2App.cardData.length <= 0) {
                console.log('waiting for cardData');
                await sleep(1000);
                continue;
            }

            //发射按钮处理，发射按钮点击后也自动处理增加导入按钮(刷出来的晚，所以放在循环里),只处理一次
            if (!faSheBtnProcessed && group.childElementCount > 3) {
                Array.from(group.children).forEach((t) => {
                    if (t.textContent == '发射') {
                        setInterval(() => {
                            processFaSheProducts(vue2App);
                        }, 2000);
                        t.style.background = 'green';
                        t.textContent = '发射或导入';
                        t.addEventListener('click', () => {
                            //自动搜索需要的活动页
                            vue2App.transmitForm.anchor_name = 1569406692;
                            vue2App.searchLaunchList();
                        });
                        faSheBtnProcessed = true;
                    }
                });
            }

            //获取所有商品Elements
            let elements = document.getElementsByClassName('view-shop-content')[0].getElementsByClassName('el-checkbox');
            if (!needRequestPrice && (elements.length != vue2App.cardData.length || elements.length == lasProductsCount)) {
                console.log('没有需要获取价格的商品，并且数量没有变化，不需要刷新，elements.length：' + elements.length);
                await sleep(3000);
                continue;
            }

            //获取没有进货价的商品列表，缓存中已有的则赋值过来并重算利润
            let noJinHuoPriceDatas = {};
            for (let i = 0; i < vue2App.cardData.length; i++) {
                let data = vue2App.cardData[i];
                if (data.jinHuoPrice == undefined || data.jinHuoPrice === 0) {
                    if (data.p_id in cachedProductsMap) {
                        data.jinHuoPrice = cachedProductsMap[data.p_id].jinHuoPrice;
                    }
                    if (data.jinHuoPrice == undefined || data.jinHuoPrice === 0) {
                        noJinHuoPriceDatas[data.p_id] = data;
                        needRequestPrice = true;
                    } else {
                        //更新一下利润，因为dy_sale_price可能有调整
                        data.liRun = parseInt(data.dy_sale_price) - data.jinHuoPrice;
                        processCachedProduct(cachedProductsMap[data.p_id], data);
                    }
                }
            }

            lasProductsCount = elements.length;

            //处理每个Card的显示效果
            for (let i = 0; i < elements.length; i++) {
                let element = elements[i];
                if (element.childElementCount >= 3) {
                    continue;
                }

                let data = vue2App.cardData[i];
                //取消平台自采的鼠标提示，影响勾选ID
                let tipEle = element.nextElementSibling.getElementsByClassName('el-tooltip')[0];
                let newTipEle = tipEle.cloneNode(true);
                tipEle.parentElement.insertBefore(newTipEle, tipEle);
                tipEle.remove();

                //借出状态
                let node = element.lastElementChild.cloneNode(false);
                node.innerHTML = '&ensp;&ensp;' + data.lend_status;
                element.appendChild(node);

                if (data.enable_delete == 0) {
                    //没有删除按钮的添加删除按钮
                    let btn = document.createElement('button');
                    btn.textContent = '取消借出并删除';
                    btn.className = 'el-button el-button--primary el-button--mini';
                    btn.style.background = 'green';
                    btn.style.color = 'white';
                    element.parentElement.getElementsByClassName('el-row')[0].appendChild(btn);

                    btn.addEventListener('click', () => {
                        vue2App
                            .$confirm('确认要删除商品吗?', '提示', {
                                confirmButtonText: '确定',
                                cancelButtonText: '取消',
                                type: 'warning',
                            })
                            .then(() => {
                                tryDeleteBorrowedProduct(vue2App, data.p_id);
                                //延迟调用活动页删除
                                setTimeout(() => {
                                    vue2App
                                        .ajax('get', '/mis/activity/delete-product', {
                                            ids: [data.id],
                                        })
                                        .then((res) => {
                                            if (res.success) {
                                                vue2App.$message({
                                                    type: 'success',
                                                    message: '删除成功',
                                                });
                                                vue2App.updateCardData();
                                            } else {
                                                vue2App.$message({
                                                    type: 'error',
                                                    message: res.message,
                                                });
                                            }
                                        });
                                }, 2000);
                            });
                    });
                }

                //补充额外价格等信息
                let tipParentEle = element.nextElementSibling.nextElementSibling.nextElementSibling.nextElementSibling;
                let tipEles = tipParentEle.getElementsByClassName('el-tooltip');
                if (tipEles.length >= 9) {
                    continue;
                }
                let douyinPriceEle = tipEles[0];
                let shiChangPriceEle = tipEles[1];
                let xiaChiEle = tipEles[3];
                douyinPriceEle.style.color = 'red';
                douyinPriceEle.textContent = douyinPriceEle.textContent.replace('.00', '');
                if (data.jinHuoPrice != undefined && data.jinHuoPrice > 0) {
                    let jinHuoPriceEle = tipParentEle.lastChild.cloneNode(true);
                    jinHuoPriceEle.textContent = '进货价:' + data.jinHuoPrice;
                    jinHuoPriceEle.style.color = 'darkred';

                    tipParentEle.insertBefore(jinHuoPriceEle, shiChangPriceEle);
                }
                if (data.liRun != undefined) {
                    let liRunEle = tipParentEle.lastChild.cloneNode(true);
                    liRunEle.textContent = '利润:' + data.liRun;
                    liRunEle.style.color = 'red';
                    tipParentEle.insertBefore(liRunEle, shiChangPriceEle);
                }

                let ppd_outer_lowest_price = tipParentEle.lastChild.cloneNode(true);
                ppd_outer_lowest_price.textContent = '最低销售价:' + data.ppd_outer_lowest_price;
                tipParentEle.insertBefore(ppd_outer_lowest_price, shiChangPriceEle);
                let wms_sp_shelf_code = tipParentEle.lastChild.cloneNode(true);
                wms_sp_shelf_code.innerHTML = '库位:' + data.wms_w_name + '<br>&ensp;&ensp;&ensp;&ensp;&ensp;' + data.wms_sp_shelf_code;
                wms_sp_shelf_code.style.color = 'green';
                tipParentEle.insertBefore(wms_sp_shelf_code, xiaChiEle);

                let p_onsale_time = tipParentEle.lastChild.cloneNode(true);
                p_onsale_time.innerHTML = '首次在售时间:<br>' + data.p_onsale_time;
                p_onsale_time.style.color = 'green';
                tipParentEle.insertBefore(p_onsale_time, xiaChiEle);
            }

            if (!needRequestPrice) {
                console.log('都有价格，不需要获取价格，等待一会再刷新检测是否有新的商品需要处理（可能搜索了）');
                await sleep(3000);
                continue;
            }

            //没有价格信息的去请求，下次循环会刷上
            {
                vue2App.$message({
                    type: 'warning',
                    message: '有商品需要请求价格详情，稍等片刻显示,数量:' + Object.keys(noJinHuoPriceDatas).length,
                });
                let msg = await getJinHuoPrices(noJinHuoPriceDatas);
                console.log(msg);
                vue2App.$message({
                    type: 'warning',
                    message: '请求价格详情，结果:' + msg,
                });
                if (msg.includes('频繁')) {
                    vue2App.$message({
                        type: 'error',
                        message: '提示请求频繁，60S之后再请求价格信息:' + msg,
                    });
                    await sleep(60000);
                } else {
                    needRequestPrice = false;
                    //获取到价格后缓存下来，并直接进行下次循环
                    for (let p_id in noJinHuoPriceDatas) {
                        let data = noJinHuoPriceDatas[p_id];
                        if (data.jinHuoPrice > 0) {
                            if (p_id in cachedProductsMap) {
                                processCachedProduct(cachedProductsMap[data.p_id], data);
                            } else {
                                data.cacheTimeStamp = new Date().getTime();
                                cachedProductsMap[data.p_id] = data;
                                updateDB(db, productsCachedStoreName, data);
                            }
                        } else {
                            needRequestPrice = true;
                        }
                    }
                }
            }
        }
    } else if (pathname.endsWith('/mis/product/view')) {
        //商品详情页
        tryClickPriceEle(document.getElementById('in_price_mask'));
        tryClickPriceEle(document.getElementById('seller_user_masked'));
        tryClickPriceEle(document.getElementById('pangu_guide_price_mask'));
    } else if (pathname.endsWith('/toonsale/view')) {
        //批次页
        let elements = document.getElementsByClassName('hand-style');
        if (elements.length > 0) {
            for (let i = 0; i < elements.length; i++) {
                tryClickPriceEle(elements[i]);
            }
        }
    } else if (pathname.endsWith('/product-editor/index')) {
        //商品刷新页
        let vue2App = document.getElementById('vue2-app').__vue__;
        vue2App.searchForm.freemask_button = 1;
        try {
            setInterval(() => {
                clickAllProducts();
                vue2App.searchForm.freemask_button = 1; //设置不加密参数，每次搜索完会默认置为加密，这里再改回来
            }, 2000);
        } catch (error) {
            console.log(error);
        }
    } else if (pathname.endsWith('/live/index')) {
        //直播管理页,自动搜索活动页
        let vue2App = document.getElementById('vue2-app').__vue__;
        vue2App.searchForm.user_id = 1569406692;
        vue2App.handleSearch();
    } else if (pathname.endsWith('/live/create')) {
        // //创建活动页
        // let inputEles = document.getElementsByClassName('select2-search__field');
        // if (inputEles.length != 3) {
        //     return;
        // }
        // inputEles[0].setAttribute('value', '张儒崎');
        // inputEles[1].value = '张儒崎';
        // let vue2App = document.getElementById('vue2-app').__vue__;
    }
})();

const formData = new FormData();
formData.append('group_id', 0);
formData.append('is_new', 1);
async function processFaSheProducts(vue2App) {
    try {
        let flagEles = document.getElementsByClassName('el-form demo-form-inline el-form--inline');
        if (flagEles == null || flagEles.length == 0) {
            return;
        }
        if (!(flagEles[0].childElementCount > 3 && flagEles[0].children[2].textContent.includes('直播间名称'))) {
            return; //商品详情页的结构也差不多，会触发下面的逻辑，所以这里再过滤一下
        }
        let ele = document.getElementsByClassName('el-table modal-form-table el-table--fit el-table--enable-row-hover el-table--enable-row-transition');
        if (ele == null || ele.length == 0) {
            return;
        }
        let rowEles = ele[0].getElementsByClassName('el-table__row');
        if (rowEles == null || rowEles.length == 0) {
            return;
        }

        let excelRaw = await exportProducts2ExcelRaw(vue2App);
        if (excelRaw == undefined) {
            return;
        }
        formData.set('file', excelRaw, 'exports.xlsx');
        Array.from(rowEles).forEach((rowEle) => {
            let btnParent = rowEle.firstChild.firstChild;
            if (btnParent.childElementCount >= 2) {
                return;
            }
            btnParent.style.display = 'inline';
            let btn = btnParent.firstChild;
            let aid = btnParent.parentElement.nextElementSibling.nextElementSibling.textContent;
            try {
                //隐藏掉较早的活动页
                let startTimeStr = btnParent.parentElement.parentElement.children[8].textContent;
                if (new Date(startTimeStr).getFullYear() < 2024) {
                    btnParent.parentElement.parentElement.style.display = 'none';
                }
            } catch (error) {
                console.log(error);
            }
            btn.style.outline = 'auto';
            let importBtn = btn.cloneNode(true);
            importBtn.textContent = '导入';
            importBtn.style.background = 'green';
            btnParent.appendChild(importBtn);
            importBtn.addEventListener('click', () => {
                formData.set('id', aid);
                $.ajax({
                    type: 'post',
                    url: '/mis/activity/new-import-excel',
                    // contentType: "multipart/form-data",
                    cache: false, //上传文件无需缓存
                    processData: false, //用于对data参数进行序列化处理 这里必须false
                    contentType: false, //必须
                    data: formData,
                    success(result) {
                        if (result.code === 0) {
                            vue2App.$message({
                                type: 'success',
                                message: '导入成功! 2秒后自动打开目标活动页:' + aid,
                            });
                            setTimeout(() => {
                                window.open('https://mis.aplum.com/mis/activity-new/view-douyin-live?id=' + aid);
                            }, 2000);
                        } else {
                            vue2App.$message({
                                type: 'error',
                                message: result.msg,
                            });
                        }
                    },
                    error(xhr) {
                        vue2App.$message({
                            type: 'error',
                            message: xhr.statusText,
                        });
                    },
                });
            });
        });
    } catch (error) {
        console.log(error);
    }
}

async function exportProducts2ExcelRaw(vue2App) {
    try {
        let selectedProducts = vue2App.selectedProducts;
        if (selectedProducts == null || selectedProducts.length <= 0) {
            return;
        }
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('sheet1');
        worksheet.columns = [{ header: 'id', key: 'id' }];

        for (let index = 0; index < selectedProducts.length; index++) {
            worksheet.addRow([selectedProducts[index].p_id]);
        }
        const buffer = await workbook.xlsx.writeBuffer();
        return new Blob([buffer], {
            type: 'application/octet-stream',
        });
    } catch (error) {
        console.log(error);
    }
}

async function addProductsToWorksheet(workbook, worksheet, vue2App, products, imageStartIndex, imageCount) {
    try {
        let cachedProductsMap = {};
        if (imageCount > 0) {
            //获取缓存数据
            var cachedProducts = await cursorGetData(db, productsCachedStoreName);
            for (let index = 0; index < cachedProducts?.length; index++) {
                let t = cachedProducts[index];
                if ('photo_base64s' in t) {
                    cachedProductsMap[t.p_id] = t;
                }
            }
        }

        for (let index = 0; index < products.length; index++) {
            let t = products[index];
            let pUrl = 'https://mis.aplum.com/mis/product/view?id=' + t.p_id;
            worksheet.addRow([
                {
                    text: t.p_id,
                    hyperlink: pUrl,
                    tooltip: pUrl,
                },
                t.brand_name + '-' + t.p_name,
                Math.floor(t.dy_sale_price),
                t.jinHuoPrice,
                t.liRun,
                // Math.floor(t.ppd_outer_lowest_price),
                t.lend_status,
                t.wms_w_name + ' ' + t.wms_sp_shelf_code,
                t.p_onsale_time,
            ]);

            if (imageCount <= 0) {
                continue;
            }
            if (t.p_photo_urls.length < imageCount) {
                imageCount = t.p_photo_urls.length;
            }

            if (t.p_photo_urls.length >= 7) {
                // 第七张图片是带全套主图，需要交换一下位置
                let tempUrl = t.p_photo_urls[1];
                t.p_photo_urls[1] = t.p_photo_urls[6];
                t.p_photo_urls[6] = tempUrl;
            }

            let photo_base64s;
            if (t.p_id in cachedProductsMap) {
                photo_base64s = cachedProductsMap[t.p_id].photo_base64s;
            }
            if (photo_base64s == null) {
                photo_base64s = [];
            }
            for (let index2 = 0; index2 < imageCount; index2++) {
                let row = index + 1;
                let column = index2 + imageStartIndex;
                let base64Data;
                if (photo_base64s.length > index2) {
                    base64Data = photo_base64s[index2];
                }
                if (base64Data == undefined) {
                    vue2App.$message({
                        type: 'success',
                        message: '正在下载:第(' + (index + 1) + '/' + products.length + ')个商品的(' + (index2 + 1) + '/' + imageCount + ')张图片',
                    });
                    let url = t.p_photo_urls[index2] + '?imageMogr2/thumbnail/300'; //缩放一下，否则太大了
                    base64Data = await imageToBase64(url);
                    photo_base64s[index2] = base64Data;
                }
                let imageId = workbook.addImage({
                    base64: base64Data,
                    extension: 'png',
                });
                worksheet.addImage(imageId, {
                    tl: { col: column, row: row },
                    br: { col: column + 1, row: row + 1 },
                    ext: { width: 100, height: 100 },
                    editAs: 'undefined',
                });
            }
            if (photo_base64s.length > 0) {
                t.photo_base64s = photo_base64s;
                await updateDB(db, productsCachedStoreName, t);
            }
        }
    } catch (error) {
        console.log(error);
    }
}

//导出商品信息到Excel，可以控制导出图片数量，数量越多导出越慢
async function exportProducts2Excel(vue2App, imageCount) {
    let allProducts = [];
    var products = await cursorGetData(db, storeName);
    let allPids = [];
    for (let index = 0; index < products?.length; index++) {
        let t = products[index];
        if (allPids.includes(t.p_id)) {
            continue;
        }
        allPids.push(t.p_id);
        allProducts.push(t);
    }
    for (let index = 0; index < vue2App.selectedProducts?.length; index++) {
        let t = vue2App.selectedProducts[index];
        if (allPids.includes(t.p_id)) {
            continue;
        }
        allPids.push(t.p_id);
        allProducts.push(t);
    }

    if (allProducts.length <= 0) {
        vue2App.$message({
            type: 'warn',
            message: '缓存中没有商品，请至少选择1个商品，才能导出',
        });
        return;
    }

    let excelFileName = getExcelFileName();
    vue2App.$message({
        type: 'success',
        message: '开始导出Excel文件:' + excelFileName + ',' + allPids.join(','),
    });

    const workbook = new ExcelJS.Workbook();
    // 创建一个冻结了第一行和第一列的工作表
    const worksheet = workbook.addWorksheet('sheet1', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    worksheet.properties.defaultRowHeight = 100;
    worksheet.pageSetup.horizontalCentered = true;
    worksheet.pageSetup.verticalCentered = true;

    let columnStyle = { alignment: { vertical: 'middle', horizontal: 'center', wrapText: true } };
    let columns = [
        { header: 'id', key: 'id', width: 9, style: columnStyle },
        { header: 'brand-name', key: 'brand-name', width: 15, style: columnStyle },
        { header: '抖音价', key: 'dy_sale_price', width: 6, style: columnStyle }, //p_discount_price 折扣价目前无权限获取
        { header: '进货价', key: 'jinHuoPrice', width: 6, style: columnStyle },
        { header: '利润', key: 'liRun', width: 6, style: columnStyle },
        // { header: '最低价', key: 'ppd_outer_lowest_price', width: 6, style: columnStyle },
        { header: '借出状态', key: 'lend_status', width: 6, style: columnStyle },
        { header: '库位', key: 'wms_sp_shelf_code', width: 10, style: columnStyle },
        { header: '首次在售时间', key: 'p_onsale_time', width: 10, style: columnStyle },
    ];
    let imageStartIndex = columns.length;

    for (let i = 1; i <= imageCount; i++) {
        if (i == 2) {
            columns.push({ header: '图' + i + '(全套图)', key: 'image' + i, width: 20, style: columnStyle });
        } else {
            columns.push({ header: '图' + i, key: 'image' + i, width: 20, style: columnStyle });
        }
    }
    worksheet.columns = columns;

    await addProductsToWorksheet(workbook, worksheet, vue2App, allProducts, imageStartIndex, imageCount);
    // worksheet.getRow(1).height=10
    const buffer = await workbook.xlsx.writeBuffer();

    let blob = new Blob([buffer], {
        type: 'application/octet-stream',
    });

    window.saveAs(blob, excelFileName);
    vue2App.$message({
        type: 'success',
        message: '导出Excel文件成功,自动清空缓存:' + excelFileName,
    });
    deleteDBStore(db, storeName);
}

// 图片转base64
function imageToBase64(url) {
    return new Promise((resolve) => {
        const image = new Image();
        // 先设置图片跨域属性
        image.crossOrigin = 'Anonymous';
        // 再给image赋值src属性，先后顺序不能颠倒
        image.src = url;
        image.onload = function () {
            const canvas = document.createElement('CANVAS');
            // 设置canvas宽高等于图片实际宽高
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
            // toDataUrl可以接收2个参数，参数一：图片类型，参数二： 图片质量0-1（不传默认为0.92）
            const dataURL = canvas.toDataURL('image/png');
            resolve(dataURL);
        };
        image.onerror = () => {
            resolve({ message: '相片处理失败' });
        };
    });
}

// function Toast(msg,duration){
//     try {
//         duration=isNaN(duration)?3000:duration;
//         var m = document.createElement('div');
//         m.innerHTML = msg;
//         m.style.cssText="max-width:60%;min-width: 150px;padding:0 14px;height: 40px;color: rgb(255, 255, 255);line-height: 40px;text-align: center;border-radius: 4px;position: fixed;top: 50%;left: 50%;transform: translate(-50%, -50%);z-index: 9999999999;background: rgba(0, 0, 0,.7);font-size: 16px;";
//         document.body.appendChild(m);
//         setTimeout(function() {
//           var d = 0.5;
//           m.style.webkitTransition = '-webkit-transform ' + d + 's ease-in, opacity ' + d + 's ease-in';
//           m.style.opacity = '0';
//           setTimeout(function() { document.body.removeChild(m) }, d * 1000);
//         }, duration);
//     } catch (error) {
//         console.log(error)
//     }
// }

function clickAllProducts() {
    try {
        let rows = document.getElementsByClassName('el-table__body-wrapper')[0].getElementsByClassName('el-table_1_column_6 is-left');
        if (rows.length <= 0) {
            return;
        }
        for (let i = 0; i < rows.length; i++) {
            let priceEle = rows[i].getElementsByClassName('text-danger')[0];
            tryClickPriceEle(priceEle);
            let sellerEle = rows[i].parentElement.getElementsByClassName('el-button el-button--text')[1];
            tryClickPriceEle(sellerEle);
        }
    } catch (error) {
        console.log(error);
    }
}

function getExcelFileName() {
    try {
        let id = document.URL.match(/\bid=(\d+)/)[1];
        let activityName = document.getElementsByClassName('el-descriptions-row')[2].lastChild.textContent;
        return id + '_' + activityName + '_' + getCurrentTimeFormatted() + '.xlsx';
    } catch (error) {
        console.log(error);
        return getCurrentTimeFormatted() + '.xlsx';
    }
}

function getCurrentTimeFormatted() {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

function processBorrowTip() {
    try {
        //检测到借出提示，就把倒计时设置为1秒
        document.getElementsByClassName('global-modal-div')[0].getElementsByTagName('span')[0].textContent = 1;
    } catch (error) {
        // console.log(error)
    }
}

function checkEnable() {
    try {
        let name = getCookie('http_login_name');
        if (name === null || name.length <= 0) {
            return false;
        }
        return name.includes('tangtianyu') || name.includes('zhangruqi');
    } catch (error) {
        console.log(error);
    }
    return true;
}

let searchForm = {
    pageIndex: 1,
    pageSize: 20,
    brand_id: '',
    series_id: '',
    guide_product_id: '',
    creator: '',
    user_id: '',
    category_id: '',
    id: '',
    name: '',
    features: '',
    storage: '',
    customer_type: '',
    // hasNoRemark: 0,
    is_out_product: '',
    hasShelf: '',
    seller_confirm: '',
    is_live_single: '',
    borrowed: '',
    has_feature: '',
    dispatch_type: '',
    treatment: '',
    cooperate_type: '',
    adjust_type: '',
    status: [],
    condition_level: '',
    provider: '',
    photo_status_by_auditor: '',
    current_discount_rate_from: '',
    current_discount_rate_to: '',
    price_from: '',
    price_to: '',
    discount_price_from: '',
    discount_price_to: '',
    discount_rate_from: '',
    discount_rate_to: '',
    discount_sale_from: '',
    discount_sale_to: '',
    purchase_price_from: '',
    purchase_price_to: '',
    discount_capacity_from: '',
    discount_capacity_to: '',
    c_s_from: '',
    c_s_to: '',
    create_time_from: '',
    create_time_to: '',
    onsale_time_from: '',
    onsale_time_to: '',
    sold_time_from: '',
    sold_time_to: '',
    settle_time_from: '',
    settle_time_to: '',
    rephoto_time_from: '',
    rephoto_time_to: '',
    photo_taker: '',
    sortCreateTime: 'noSort',
    onSaleTime: 'noSort',
    sortFirst: '',
    area_ids: [],
    productModel: '',
    freemask_button: 1,
};
function getJinHuoPrices(noJinHuoPriceDatas) {
    if (noJinHuoPriceDatas == null) {
        resolve('noJinHuoPriceDatas is null');
        return;
    }
    let keys = Object.keys(noJinHuoPriceDatas);
    if (keys.length <= 0) {
        resolve('noJinHuoPriceDatas count is 0');
        return;
    }

    searchForm.id = keys.join(',');
    console.log('getJinHuoPrices:' + searchForm.id);
    searchForm.pageSize = keys.length;
    return new Promise((resolve) => {
        try {
            $.get('https://mis.aplum.com/mis/apis/product-editor-api/index', searchForm, (res) => {
                if (res.code === 0) {
                    let tableData = res.data.list;
                    if (tableData == null || tableData.length <= 0) {
                        console.log('fail');
                    } else {
                        tableData.forEach((data) => {
                            try {
                                let noJinHuoPriceData = noJinHuoPriceDatas[data.productId];
                                noJinHuoPriceData.jinHuoPrice = parseInt(data.productPrice.match(/进货价：(\d+)/)[1]);
                                noJinHuoPriceData.liRun = parseInt(noJinHuoPriceData.dy_sale_price) - noJinHuoPriceData.jinHuoPrice;
                            } catch (error) {
                                console.log(error);
                            }
                        });
                    }
                }
                resolve(res.msg);
            });
        } catch (error) {
            resolve(error);
        }
    });
}

function tryDeleteBorrowedProduct(vue2App, pid) {
    try {
        $.ajax({
            url:
                '/mis/borrow-ticket/detail-list?TBorrowTicketProductSearch%5Bborrow_ticket_id%5D=&TBorrowTicketProductSearch%5Bop_id%5D=&TBorrowTicketProductSearch%5Bcategory%5D=&TBorrowTicketProductSearch%5Bexpress_type%5D=&TBorrowTicketProductSearch%5Bproduct_id%5D=' +
                pid +
                '&TBorrowTicketProductSearch%5Bcreate_time_start%5D=&TBorrowTicketProductSearch%5Bcreate_time_end%5D=&TBorrowTicketProductSearch%5Bremark%5D=&TBorrowTicketProductSearch%5Bproduct_status%5D=&TBorrowTicketProductSearch%5Bticket_status%5D=&TBorrowTicketProductSearch%5Bblogger_nickname%5D=&TBorrowTicketProductSearch%5Bmulti_status%5D=',
            type: 'get',
            // data: {"TBorrowTicketProductSearch[product_id]": 13043549},
            success(result) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(result, 'text/html');
                let borrowid = doc.getElementsByClassName('table table-striped table-bordered')[0].querySelector('tbody > tr').getAttribute('data-key');
                if (borrowid === null) {
                    console.log('tryDeleteBorrowedProduct can not find borrowid,pid =' + pid);
                    return;
                } else {
                    console.log('tryDeleteBorrowedProduct borrowid =' + borrowid);
                }
                $.ajax({
                    url: '/mis/borrow-ticket/delete-product-new',
                    type: 'post',
                    data: { id: borrowid },

                    success(result) {
                        console.log(result.msg);
                        if (result.code != 0) {
                            vue2App.$message({
                                type: 'success',
                                message: result.msg,
                            });
                        }
                    },
                    error(xhr) {
                        console.log(xhr.statusText);
                        vue2App.$message({
                            type: 'fail',
                            message: xhr.statusText,
                        });
                    },
                });
            },
            error(xhr) {
                console.log(xhr);
                vue2App.$message({
                    type: 'fail',
                    message: xhr.statusText,
                });
            },
        });
    } catch (error) {
        console.log(error);
    }
}

function tryClickPriceEle(ele) {
    try {
        if (ele == null) {
            return;
        }
        if (!ele.textContent.includes('****')) {
            return;
        }
        ele.click();
    } catch (error) {
        console.log(error);
    }
}

function getCookie(name) {
    let cookies = document.cookie.split('; ');

    for (let i = 0; i < cookies.length; i++) {
        let cookie = cookies[i];
        let [cookieName, value] = cookie.split('=');

        if (cookieName === name) {
            return value;
        }
    }

    return null; //如果没有找到指定的 cookie，返回 null
}

//异步等待元素的Visibility变为指定值
// eslint-disable-next-line no-unused-vars
async function waitForElementVisibility(element, timeoutInSeconds, visibility) {
    if (element === null) {
        return true;
    }
    for (let index = 0; index < timeoutInSeconds; index++) {
        await new Promise((resolve) => {
            setTimeout(resolve, 1000);
        });
        console.log('waitForSelectorVisibility index:' + index);
        if (element.checkVisibility() === visibility) {
            return true;
        }
    }
    return false;
}

//异步等待元素出现
// eslint-disable-next-line no-unused-vars
async function waitForSelector(selector, timeoutInSeconds) {
    for (let index = 0; index < timeoutInSeconds; index++) {
        await new Promise((resolve) => {
            setTimeout(resolve, 1000);
        });
        console.log('waitForSelector index:' + index);
        if (document.querySelector(selector) !== null) {
            return true;
        }
    }
    return false;
}

//数据库indexedDB相关操作封装
async function deleteOldCachedProducts(storeName) {
    try {
        var products = await cursorGetData(db, storeName);
        let deletePids = [];
        let expireTimeStamp = new Date().getTime() - 1000 * 60 * 60 * 24 * 30;
        for (let index = 0; index < products?.length; index++) {
            let t = products[index];
            if ('cacheTimeStamp' in t && expireTimeStamp > t['cacheTimeStamp']) {
                deletePids.push(t.p_id);
            }
        }
        deletePids.forEach((pid) => {
            deleteDB(db, storeName, pid);
        });
    } catch (error) {
        console.log(error);
    }
}

function processCachedProduct(cachedProduct, product) {
    if (cachedProduct.liRun != product.liRun) {
        cachedProduct.dy_sale_price = product.dy_sale_price;
        cachedProduct.liRun = product.liRun;
        cachedProduct.jinHuoPrice = product.jinHuoPrice;
        cachedProduct.cacheTimeStamp = new Date().getTime();
        //还用该对象去更新，因为里面可能存储的有图片base64，不能直接用data
        updateDB(db, productsCachedStoreName, cachedProduct);
    }
}

/**
 * 封装的方法以及用法
 * 打开数据库
 */
function openDB(dbName, version = 1) {
    return new Promise((resolve, reject) => {
        let indexedDB = window.indexedDB || window.webkitIndexedDB || window.mozIndexedDB || window.msIndexedDB;
        if (!indexedDB) {
            console.log('你的浏览器不支持IndexedDB');
            resolve(null);
        }
        let db;
        const request = indexedDB.open(dbName, version);
        request.onsuccess = function (event) {
            db = event.target.result; // 数据库对象
            resolve(db);
        };

        request.onerror = function (event) {
            reject(event);
        };

        request.onupgradeneeded = function (event) {
            // 数据库创建或升级的时候会触发
            console.log('onupgradeneeded');
            db = event.target.result; // 数据库对象
            // let objectStore
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'p_id' }); // 创建表
            }
            if (!db.objectStoreNames.contains(productsCachedStoreName)) {
                db.createObjectStore(productsCachedStoreName, { keyPath: 'p_id' }); // 创建表
            }
        };
    });
}

/**
 * 新增数据
 */
// eslint-disable-next-line no-unused-vars
function addData(db, storeName, data) {
    return new Promise((resolve, reject) => {
        let request = db
            .transaction([storeName], 'readwrite') // 事务对象 指定表格名称和操作模式（"只读"或"读写"）
            .objectStore(storeName) // 仓库对象
            .add(data);

        request.onsuccess = function (event) {
            resolve(event);
        };

        request.onerror = function (event) {
            // throw new Error(event.target.error)
            reject(event);
        };
    });
}

/**
 * 通过主键读取数据
 */
// eslint-disable-next-line no-unused-vars
function getDataByKey(db, storeName, key) {
    return new Promise((resolve, reject) => {
        let transaction = db.transaction([storeName]); // 事务
        let objectStore = transaction.objectStore(storeName); // 仓库对象
        let request = objectStore.get(key);

        request.onerror = function (event) {
            reject(event);
        };

        // eslint-disable-next-line no-unused-vars
        request.onsuccess = function (event) {
            resolve(request.result);
        };
    });
}

/**
 * 通过游标读取数据
 */
function cursorGetData(db, storeName) {
    let list = [];
    let store = db
        .transaction(storeName, 'readwrite') // 事务
        .objectStore(storeName); // 仓库对象
    let request = store.openCursor(); // 指针对象
    return new Promise((resolve, reject) => {
        request.onsuccess = function (e) {
            let cursor = e.target.result;
            if (cursor) {
                // 必须要检查
                list.push(cursor.value);
                cursor.continue(); // 遍历了存储对象中的所有内容
            } else {
                resolve(list);
            }
        };
        request.onerror = function (e) {
            reject(e);
        };
    });
}

/**
 * 通过索引读取数据
 */
// eslint-disable-next-line no-unused-vars
function getDataByIndex(db, storeName, indexName, indexValue) {
    let store = db.transaction(storeName, 'readwrite').objectStore(storeName);
    let request = store.index(indexName).get(indexValue);
    return new Promise((resolve, reject) => {
        request.onerror = function (e) {
            reject(e);
        };
        request.onsuccess = function (e) {
            resolve(e.target.result);
        };
    });
}

/**
 * 通过索引和游标查询记录
 */
// eslint-disable-next-line no-unused-vars
function cursorGetDataByIndex(db, storeName, indexName, indexValue) {
    let list = [];
    let store = db.transaction(storeName, 'readwrite').objectStore(storeName); // 仓库对象
    let request = store
        .index(indexName) // 索引对象
        .openCursor(IDBKeyRange.only(indexValue)); // 指针对象
    return new Promise((resolve, reject) => {
        request.onsuccess = function (e) {
            let cursor = e.target.result;
            if (cursor) {
                list.push(cursor.value);
                cursor.continue(); // 遍历了存储对象中的所有内容
            } else {
                resolve(list);
            }
        };
        request.onerror = function (ev) {
            reject(ev);
        };
    });
}

/**
 * 更新数据，有则更新，没有则添加
 */
// eslint-disable-next-line no-unused-vars
function updateDB(db, storeName, data) {
    let request = db
        .transaction([storeName], 'readwrite') // 事务对象
        .objectStore(storeName) // 仓库对象
        .put(data);

    return new Promise((resolve) => {
        request.onsuccess = function (ev) {
            resolve(ev);
        };

        request.onerror = function (ev) {
            resolve(ev);
        };
    });
}

/**
 * 删除数据
 */
// eslint-disable-next-line no-unused-vars
function deleteDB(db, storeName, id) {
    let request = db.transaction([storeName], 'readwrite').objectStore(storeName).delete(id);

    return new Promise((resolve) => {
        request.onsuccess = function (ev) {
            resolve(ev);
        };

        request.onerror = function (ev) {
            resolve(ev);
        };
    });
}

// 清空表数据
// 数据库,表名
function deleteDBStore(db, storeName) {
    // 表名事务权限控制
    let transaction = db.transaction(storeName, 'readwrite');
    // 进行操作
    let objectStore = transaction.objectStore(storeName);
    // 清除数据
    let clearResult = objectStore.clear();
    // 清除成功的回调函数
    clearResult.onsuccess = function (e) {
        console.log('表名[' + storeName + ']数据清除成功,状态为：' + e.isTrusted);
    };
}

/**
 * 删除数据库
 */
// eslint-disable-next-line no-unused-vars
function deleteDBAll(dbName) {
    console.log(dbName);
    let deleteRequest = window.indexedDB.deleteDatabase(dbName);
    return new Promise((resolve) => {
        deleteRequest.onerror = function (event) {
            console.log('删除失败' + event);
            resolve(false);
        };
        deleteRequest.onsuccess = function (event) {
            console.log('删除成功' + event);
        };
    });
}

/**
 * 关闭数据库
 */
// eslint-disable-next-line no-unused-vars
function closeDB(db) {
    db.close();
    console.log('数据库已关闭');
}

/**
 * 实现sleep函数
 */
function sleep(time) {
    return new Promise((resolve) => setTimeout(resolve, time));
}
