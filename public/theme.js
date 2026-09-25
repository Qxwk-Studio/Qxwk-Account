// 主题（浅色 / 深色）——login.html / account.html / setup.html 三页共用
//
// 本文件必须在 <head> 里用**同步** <script src> 加载（不加 defer）：
// 它要在首次绘制之前把 <html data-theme> 写好，否则会先按默认浅色渲染一帧再跳成深色（闪白）。
//
// 原来这段逻辑是各页内联脚本里的三份拷贝（login / account 完全相同，setup 少一段按钮绑定），
// 抽出来合并成一份，避免日后改主题行为要改多处。
/* 取值优先级：localStorage('theme') → 系统 prefers-color-scheme */
(function () {
  var KEY = 'theme';
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  function system() { return mq.matches ? 'dark' : 'light'; }
  function stored() { try { var v = localStorage.getItem(KEY); return (v === 'dark' || v === 'light') ? v : null; } catch (e) { return null; } }
  function apply(t) { root.setAttribute('data-theme', t); }
  function current() { return stored() || system(); }
  apply(current());
  function toggle() { var next = current() === 'dark' ? 'light' : 'dark'; apply(next); try { localStorage.setItem(KEY, next); } catch (e) {} }

  // 切换按钮在 <body> 里，本脚本同步执行时它还未必被解析到，故轮询等待（沿用原内联实现的策略：
  // 不等 DOMContentLoaded，避免被后面的同步 <script src> 阻塞导致按钮长时间点了没反应）。
  // 限次 2 秒：页面本就没有该按钮时（setup.html）不会留下一个永不停止的定时器。
  var tries = 40;
  (function bindToggle() {
    var btn = document.getElementById('themeToggle');
    if (btn) { btn.addEventListener('click', toggle); return; }
    if (--tries > 0) setTimeout(bindToggle, 50);
  })();

  if (mq.addEventListener) mq.addEventListener('change', function (e) { if (!stored()) apply(e.matches ? 'dark' : 'light'); });
  else if (mq.addListener) mq.addListener(function (e) { if (!stored()) apply(e.matches ? 'dark' : 'light'); });
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(current()); });
})();