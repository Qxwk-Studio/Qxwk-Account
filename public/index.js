// Qxwk 通行证 · 根路径分流
// Cookie 是 HttpOnly，前端读不到，只能问 /api/me 判断登录态。

(async function () {
  'use strict';
  try {
    await api('/api/me');
    location.replace('/account.html');
  } catch {
    location.replace('/login.html');
  }
})();
