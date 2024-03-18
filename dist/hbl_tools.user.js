// ==UserScript==
// @name                hbl_tools
// @namespace           https://github.com/fengxing/fbl_tools
// @version             0.0.1
// @description         hbl_tools
// @author              fengxing
// @copyright           fengxing
// @license             MIT
// @match               *://*.aplum.com/mis/*
// @run-at              document-idle
// @supportURL          https://baidu.com
// @homepage            https://baidu.com
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_setClipboard
// @icon                data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAttJREFUaEPtWVtSAjEQTKC0vISUn3IK8WTAycBT6KeFl7C0JFZGg9mQTPcsiyUqn5qdpLvnlYl3J/7zJ35+9/cA3E/OF965uSgXwjqMx8vp4/O6j5JiK4Qb5/0s2oo2rp9eby22aAXury5mfrtd1YwH55bTzcvCsnGHiOLD680LfS564cPl2UqYavwsIDQyRFgDITyAyXlQGf50J0YF//Y218gQVyJVoAAgxphDW9eE0eiWiS0KQNz8ASlgPSFYP6gCcS8t6FJGMmFQ4ilmJDYb0QogFVjGEkhNUdZ9oq3BAFgyB8poFjJoAKULxU1qf0NuVCaExHauiIUMCkBr09KtmI077Ge+3ocM2oVam9aCW5NfI6K0xZBBAUCbWlTIiagdsFSBAQFdSGM/+fteio1V2fu7Mh52TaBSaa2upAKwGEOZJQeDmLUEtArAYmhIABbiOgDih4mpXZ8u7aFeGfv0ShYV5N6RXHI0Wuc9kgBAbQKqjBb2c1dSM1Z+caoUl3QmD9lD7IONtMKGVGCI9ZC9RkbZuVq6XqIS3Pq/Yr/jxjUVnFv6726T++JsfXfaAEJY7zVke0gPkJhhO8ZBk900sVDcDwbxoYF2SBCj+IyZ6CONKiMTKQNgStArjlB2I8/ULWRXFzO33cropMwAh+Tsmgqm2oIKWUtmSyuBcnZnD8R+UVs08n53Mye9fjaRa8XC3p2hkllYl2Ta91xNeB9gLhnspsglmctT5Y6Bs3U5kc5nNpZNUZvMEmFSIC1usce4WL5hDiJ3SQsRvQAcbazyWWOQezWrNXagrxXqNM0wEkcp9ziDLVAZLZtKdlOGxRZbMAvtYgA8cKQnIlrRgR5LeACnPF5HzR7NumEh6pWSqeEU+MlPTNJyk1MChmRkC41xetWBsi/KjaD7Qg2UBoJ1H2n7GcbyNVJ55cuPx+k4cLK+ESd7ElvZi2UfIswArICPvf4fwLEZRvbfAT8jlbXobXLcAAAAAElFTkSuQmCC
// ==/UserScript==

// const clickedProducts= new Set();
(function() {
    console.log("fengxing");
    let enable = checkEnable();
    if (!enable)
    {
        console.log("checkEnable is false");
        return;
    }
    let pathname = location.pathname;
    console.log(pathname);
    processBorrowTip();
    if(pathname.endsWith("/mis/product/view"))
    {//商品详情页
        tryClickPriceEle(document.getElementById("dis_price_mask"))
        tryClickPriceEle(document.getElementById("seller_user_masked"))
        tryClickPriceEle(document.getElementById("pangu_guide_price_mask"))
    }
    else if (pathname.endsWith("/activity-new/view-douyin-live"))
    {
        let group = document.getElementsByClassName("el-radio-group")[1];
        var span = document.createElement("span");
        span.innerHTML="<br><br><br><br>"
        span.className="el-checkbox__label"
        group.appendChild(span);
        let btn = document.createElement("button");
        btn.textContent = "批量复制商品ID";
        btn.className="el-radio-button__inner";
        btn.style.background = 'green';
        btn.style.color="white"

        let vue2App = document.getElementById("vue2-app").__vue__

        btn.addEventListener("click", () => {
            let selectedProducts=vue2App.selectedProducts
            let selectedPids=selectedProducts.map((t) => t.p_id)
            console.log(selectedPids)
            if (!vue2App.checkSelectProduct()) {
                return;
            }
            let copyStr=selectedPids.join("\n")
            GM_setClipboard(copyStr)
            vue2App.$message({
                type: "success",
                message: "复制成功，粘贴即可，"+copyStr,
            });

            // tryDeleteBorrowedProduct(13043549)
        });
        group.appendChild(btn);

        // let pidToData= new Map()//key:pid,value:data
        // (vue2App.cardData ?? []).forEach(
        //     (t) => (pidToData.set(t.p_id,t))
        // );

        let timer = setInterval(()=>{
            if(vue2App.cardData.length<=0)
            {
                return;
            }
            let elements = document.getElementsByClassName("view-shop-content")[0].getElementsByClassName("el-checkbox");
            if (elements.length==vue2App.cardData.length)
            {
                for (let i = 0; i < elements.length; i++)
                {
                    if(elements[i].childElementCount>=3)
                    {
                        continue;
                    }
                    data = vue2App.cardData[i];
                    //借出状态
                    var span = document.createElement("span");
                    span.innerHTML=data.lend_status;
                    span.className="el-checkbox__label"
                    span.style.textAlign = 'right';
                    elements[i].appendChild(span);

                    //delete按钮 enable_delete
                }
            }
        },2000)
    }
    else if (pathname.endsWith("/toonsale/view"))
    {
        let elements = document.getElementsByClassName("hand-style");
        if (elements.length>0)
        {
            for (let i = 0; i < elements.length; i++)
            {
                tryClickPriceEle(elements[i])
            }
        }
    }
    else if(pathname.endsWith("/product-editor/index"))
    {//商品刷新页
        // 搜索按钮点击
        // let searchButton = document.querySelector(".el-button.el-button--primary.el-button--medium")
        // searchButton?.addEventListener("click",()=>{
        //     clickedProducts.clear()
        // })
        // clickedProducts.clear()
        try {
            let count=0
            let timer = setInterval(()=>{
                count++
                clickAllProducts()
            },1000)
        } catch (error) {
            console.log(error)
        }
    }
})();

// function getActivitySelectedPIds()
// {
//     try {
//         let selectedEles = document.getElementsByClassName("el-checkbox is-checked")
//         if (selectedEles==null || selectedEles.length<=0 )
//         {
//             return null
//         }
        
//         selectedPids=new Set()
//         for (let i = 0; i < selectedEles.length; i++)
//         {
//             selectedPids.add(selectedEles[i].textContent)
//         }
//         return selectedPids;
//     } catch (error) {
//         console.log(error)
//     } 
// }

function Toast(msg,duration){
    try {
        duration=isNaN(duration)?3000:duration;
        var m = document.createElement('div');
        m.innerHTML = msg;
        m.style.cssText="max-width:60%;min-width: 150px;padding:0 14px;height: 40px;color: rgb(255, 255, 255);line-height: 40px;text-align: center;border-radius: 4px;position: fixed;top: 50%;left: 50%;transform: translate(-50%, -50%);z-index: 9999999999;background: rgba(0, 0, 0,.7);font-size: 16px;";
        document.body.appendChild(m);
        setTimeout(function() {
          var d = 0.5;
          m.style.webkitTransition = '-webkit-transform ' + d + 's ease-in, opacity ' + d + 's ease-in';
          m.style.opacity = '0';
          setTimeout(function() { document.body.removeChild(m) }, d * 1000);
        }, duration);
    } catch (error) {
        console.log(error)
    }
  }

function clickAllProducts()
{
    try {
        document.getElementsByClassName("el-table__body-wrapper is-scrolling-left")
        let rows = document.getElementsByClassName("el-table__body-wrapper is-scrolling-left")[0].getElementsByClassName("el-table_1_column_6 is-left");
        if(rows.length<=0)
        {
            return;
        }
        for (let i = 0; i < rows.length; i++)
        {
            // let id = rows[i].parentElement.getElementsByClassName("el-button el-tooltip el-button--text")[0].textContent.trim()
            // if(!clickedProducts.has(id))
            // {
                let priceEle = rows[i].querySelector("div > sapn > div")
                tryClickPriceEle(priceEle)
                let sellerEle = rows[i].parentElement.getElementsByClassName("el-button el-button--text")[1]
                tryClickPriceEle(sellerEle)
                // clickedProducts.add(id);
            }
        // }
    } catch (error) {
        console.log(error)
    } 
}


function processBorrowTip()
{
    try {
        //检测到借出提示，就把倒计时设置为1秒
        document.getElementsByClassName("global-modal-div")[0].getElementsByTagName("span")[0].textContent=1;
    } catch (error) {
        // console.log(error)
    }
    
}

function checkEnable()
{
    try {
        let name = getCookie('http_login_name');
        if (name === null || name.length<=0)
        {
            return false;
        }
        return name.includes("tangtianyu")||name.includes("zhangruqi")
    }
    catch (error) {
        console.log(error)
    }
    return true
}

function tryDeleteBorrowedProduct(pid) {
    try {
        $.ajax({
            url: "/mis/borrow-ticket/detail-list?TBorrowTicketProductSearch%5Bborrow_ticket_id%5D=&TBorrowTicketProductSearch%5Bop_id%5D=&TBorrowTicketProductSearch%5Bcategory%5D=&TBorrowTicketProductSearch%5Bexpress_type%5D=&TBorrowTicketProductSearch%5Bproduct_id%5D="+ pid+"&TBorrowTicketProductSearch%5Bcreate_time_start%5D=&TBorrowTicketProductSearch%5Bcreate_time_end%5D=&TBorrowTicketProductSearch%5Bremark%5D=&TBorrowTicketProductSearch%5Bproduct_status%5D=&TBorrowTicketProductSearch%5Bticket_status%5D=&TBorrowTicketProductSearch%5Bblogger_nickname%5D=&TBorrowTicketProductSearch%5Bmulti_status%5D=",
            type: "get",
            // data: {"TBorrowTicketProductSearch[product_id]": 13043549},
            success(result) {
                var parser = new DOMParser();
                var doc = parser.parseFromString(result, 'text/html');
                let borrowid = doc.getElementsByClassName("table table-striped table-bordered")[0].querySelector("tbody > tr").getAttribute("data-key")
                if(borrowid ===null)
                {
                    return
                }
                $.ajax({
                    url: '/mis/borrow-ticket/delete-product-new', 
                    type: "post",
                    data:{id: borrowid}, 
                    
                    success(result) {
                        if (result.code === 0) {
                            console.log(result.message)
                        }
                    },
                    error(xhr) {
                        console.log(xhr.statusText)
                    },
                });
            },
            error(xhr) {
                console.log(xhr)
            },
        });
        
    } catch (error) {
        console.log(error)
    }
  }

function tryClickPriceEle(ele) {
    try {
        if(ele ==null)
        {
            return;
        }
        if(!ele.textContent.includes("****"))
        {
            return;
        }
        ele.click();
        
    } catch (error) {
        console.log(error)
    }
  }

function getCookie(name) {
    let cookies = document.cookie.split('; ');

    for(let i = 0; i < cookies.length; i++) {
      let cookie = cookies[i];
      let [cookieName, value] = cookie.split('=');

      if(cookieName === name) {
        return value;
      }
    }

    return null;  // 如果没有找到指定的 cookie，返回 null
  }

//异步等待元素的Visibility变为指定值
async function waitForElementVisibility(element,timeoutInSeconds,visibility) {
    if (element===null)
    {
        return true
    }
    for (let index = 0; index < timeoutInSeconds; index++) {
        await new Promise((resolve,reject)=>{
            setTimeout(resolve,1000)
        });
        console.log("waitForSelectorVisibility index:"+index)
        if (element.checkVisibility()===visibility) {
            return true;
        }
    }
    return false;
}


//异步等待元素出现
async function waitForSelector(selector,timeoutInSecondsi) {
    for (let index = 0; index < timeoutInSeconds; index++) {
        await new Promise((resolve,reject)=>{
            setTimeout(resolve,1000)
        });
        console.log("waitForSelector index:"+index)
        if (document.querySelector(selector)!==null) {
            return true;
        }
    }
    return false;
}
