/* 根页分流：有本地会话且 /api/me 校验通过 → 账号中心；否则 → 登录页。
   跨站 SSO（?redirect= 弹层 / 授权确认 / 片段回传）已下线，根页不再承担中控职责。 */
(async function () {
  var token = localStorage.getItem(LS_TOKEN);
  var loggedIn = false;
  if (token) {
    // 直接 fetch /api/me 校验（不走 api()：避免其 401 时整页跳转造成的重复跳转）
    try {
      var res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
      loggedIn = res.status === 200;
      if (!loggedIn) { localStorage.removeItem(LS_TOKEN); localStorage.removeItem(LS_USER); }
    } catch (e) { /* 网络异常：按未登录处理，由登录页兜底 */ }
  }
  location.replace(loggedIn ? 'account.html' : 'login.html');
})();
