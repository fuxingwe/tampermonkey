/* eslint-disable no-undef */
// ==UserScript==
// @name                hbl_tools
// @namespace           https://github.com/fengxing/fbl_tools
// @version             0.0.6
// @description         hbl_tools
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

(function () {
  console.log('fengxing');
  let enable = checkEnable();
  if (!enable) {
    console.log('checkEnable is false');
    return;
  }
  let pathname = location.pathname;
  console.log(pathname);
  processBorrowTip();

  if (pathname.endsWith('/mis/product/view')) {
    //商品详情页
    tryClickPriceEle(document.getElementById('in_price_mask'));
    tryClickPriceEle(document.getElementById('seller_user_masked'));
    tryClickPriceEle(document.getElementById('pangu_guide_price_mask'));
  } else if (pathname.endsWith('/activity-new/view-douyin-live')) {
    let vue2App = document.getElementById('vue2-app').__vue__;
    let group = document.getElementsByClassName('view-shop-footer')[0];
    //设置为自适应换行
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

    let exportButton = btn.cloneNode(true);
    exportButton.textContent = '批量导出(附1张图)';
    group.appendChild(exportButton);
    exportButton.addEventListener('click', async () => {
      await exportProducts2Excel(vue2App, 1);
    });
    exportButton = btn.cloneNode(true);
    exportButton.textContent = '批量导出(附3张图)';
    group.appendChild(exportButton);
    exportButton.addEventListener('click', async () => {
      await exportProducts2Excel(vue2App, 3);
    });
    exportButton = btn.cloneNode(true);
    exportButton.textContent = '批量导出(附所有图)';
    group.appendChild(exportButton);
    exportButton.addEventListener('click', async () => {
      await exportProducts2Excel(vue2App, 7);
    });

    //定时执行，补充商品信息，因为可能通过搜索来刷新数据
    setInterval(async () => {
      if (vue2App.cardData.length <= 0) {
        return;
      }
      let elements = document.getElementsByClassName('view-shop-content')[0].getElementsByClassName('el-checkbox');

      if (elements.length == vue2App.cardData.length) {
        let noJinHuoPriceDatas = {};
        for (let i = 0; i < vue2App.cardData.length; i++) {
          let data = vue2App.cardData[i];
          if (data.jinHuoPrice === undefined || data.jinHuoPrice === 0) {
            noJinHuoPriceDatas[data.p_id] = data;
          }
        }
        if (Object.keys(noJinHuoPriceDatas).length > 0) {
          let msg = await getJinHuoPrices(noJinHuoPriceDatas);
          console.log(msg);
        }

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

          if (data.jinHuoPrice != null && data.jinHuoPrice != undefined && data.jinHuoPrice > 0) {
            let jinHuoPriceEle = tipParentEle.lastChild.cloneNode(true);
            jinHuoPriceEle.textContent = '进货价:' + data.jinHuoPrice;
            jinHuoPriceEle.style.color = 'darkred';

            tipParentEle.insertBefore(jinHuoPriceEle, shiChangPriceEle);
          }
          if (data.liRun != null && data.liRun != undefined) {
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
      }
    }, 1000);
  } else if (pathname.endsWith('/toonsale/view')) {
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
  }
})();

//导出商品信息到Excel，可以控制导出图片数量，数量越多导出越慢
async function exportProducts2Excel(vue2App, imageCount) {
  if (!vue2App.checkSelectProduct()) {
    return;
  }
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

  let selectedProducts = vue2App.selectedProducts;
  let excelFileName = getExcelFileName();
  vue2App.$message({
    type: 'success',
    message: '开始导出Excel文件:' + excelFileName,
  });
  for (let index = 0; index < selectedProducts.length; index++) {
    let t = selectedProducts[index];
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

    for (let index2 = 0; index2 < imageCount; index2++) {
      let row = index + 1;
      let column = index2 + imageStartIndex;
      vue2App.$message({
        type: 'success',
        message: '正在下载:第(' + (index + 1) + '/' + selectedProducts.length + ')个商品的(' + (index2 + 1) + '/' + imageCount + ')张图片',
      });
      // console.log(index,index2,url)
      let url = t.p_photo_urls[index2] + '?imageMogr2/thumbnail/300'; //缩放一下，否则太大了
      let base64Data = await imageToBase64(url);
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
  }

  // worksheet.getRow(1).height=10
  const buffer = await workbook.xlsx.writeBuffer();
  window.saveAs(
    new Blob([buffer], {
      type: 'application/octet-stream',
    }),
    excelFileName
  );
  vue2App.$message({
    type: 'success',
    message: '导出Excel文件成功:' + excelFileName,
  });
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
    return;
  }
  let keys = Object.keys(noJinHuoPriceDatas);
  if (keys.length <= 0) {
    return;
  }

  searchForm.id = keys.join(',');
  searchForm.pageSize = keys.length;
  return new Promise((resolve) => {
    try {
      $.get('https://mis.aplum.com/mis/apis/product-editor-api/index', searchForm, (res) => {
        if (res.code === 0) {
          let tableData = res.data.list;
          if (tableData == null || tableData.length <= 0) {
            resolve('fail');
          } else {
            tableData.forEach((data) => {
              try {
                noJinHuoPriceData = noJinHuoPriceDatas[data.productId];
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
      console.log(error);
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
