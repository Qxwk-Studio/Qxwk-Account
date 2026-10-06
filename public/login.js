/* 登录/注册切换 */
// 表单区当前模式（login 登录 / email 邮箱注册 / reg 邀请码注册），决定标题与副标题文案
var currentAuthMode = 'login';
// 当前视图（login / email / reg / setpass / forgot）：语言切换时据此重跑对应渲染
var currentView = 'login';

/* 事件绑定：CSP 去掉 script-src 'unsafe-inline' 后内联 onclick / onsubmit 会被拦下，
   故 HTML 侧改为 data-action 标记，这里用一个 document 级委托统一分发（表单直接绑 submit） */
var ACTIONS = {
  switchTab: function (ds) { switchTab(ds.mode); },
  showForgot: function () { showForgot(); },
  backToLogin: function () { backToLogin(); },
  sendForgotCode: function () { sendForgotCode(); },
  sendSignupCode: function () { sendSignupCode(); },
};
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  // 原来 <a href="#"> 靠内联 onclick 的 return false 阻止跳转，这里等价地用 preventDefault
  if (el.tagName === 'A') e.preventDefault();
  var fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset, el);
});

/* 表单提交：原 onsubmit="return doLogin(event)" 等，改为直接绑 submit 事件；
   doLogin / doRegister / doEmailRegister / doSetPassword / doForgotReset 内部首行即 e.preventDefault()，与原来 return false 行为等价 */
document.getElementById('loginForm').addEventListener('submit', doLogin);
document.getElementById('emailRegForm').addEventListener('submit', doEmailRegister);
document.getElementById('regForm').addEventListener('submit', doRegister);
document.getElementById('setPassForm').addEventListener('submit', doSetPassword);
document.getElementById('forgotForm').addEventListener('submit', doForgotReset);

function switchTab(mode) {
  currentAuthMode = mode;
  currentView = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabEmailReg').classList.toggle('active', mode === 'email');
  document.getElementById('tabReg').classList.toggle('active', mode === 'reg');
  document.getElementById('loginForm').style.display = mode === 'login' ? '' : 'none';
  document.getElementById('emailRegForm').style.display = mode === 'email' ? '' : 'none';
  document.getElementById('regForm').style.display = mode === 'reg' ? '' : 'none';
  // 标题随模式切换（需求2）：三种模式各自展示对应欢迎词与副标题
  renderAuthHeader();
}

/* 标题/副标题（#authTitle / #authSubtitle）由 JS 控制：HTML 侧未挂 data-i18n，
   故语言切换时必须重跑本函数，否则标题停在旧语言 */
function renderAuthHeader() {
  var TITLES = {
    login: ['login.welcome_title', 'login.welcome_subtitle'],
    email: ['login.email_reg_title', 'login.email_reg_subtitle'],
    reg: ['login.reg_title', 'login.reg_subtitle'],
    setpass: ['login.set_password_title', 'login.set_password_subtitle'],
    forgot: ['login.forgot_title', 'login.forgot_subtitle'],
  };
  var keys = TITLES[currentView] || TITLES.login;
  document.getElementById('authTitle').textContent = t(keys[0]);
  document.getElementById('authSubtitle').textContent = t(keys[1]);
}

/* 登录/注册/设密/重置成功后的统一结尾：存会话并进入账号中心 */
function applySession(data) {
  saveSession(data);
  location.href = 'account.html';
}

/* 已登录自动跳转：本地已有有效会话时直接进入账号中心 */
async function autoRedirect() {
  var token = localStorage.getItem(LS_TOKEN);
  if (!token) return;
  try {
    await api('/me');
    location.href = 'account.html';
  } catch (e) { /* token 失效：app.js 已清 session，继续展示登录表单 */ }
}

async function doLogin(e) {
  e.preventDefault();
  var msg = document.getElementById('loginMsg');
  var btn = document.getElementById('loginBtn');
  msg.className = 'msg error';
  btn.disabled = true;
  msg.textContent = t('login.msg_logging_in');
  try {
    var data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        nickname: document.getElementById('loginNick').value.trim(),
        password: document.getElementById('loginPass').value,
      }),
    });
    // 账号密码哈希为空：要求设置密码（切换到设密码表单，昵称以后端返回的真实昵称为准）
    if (data && data.need_set_password) {
      showSetPassForm(data.identity || document.getElementById('loginNick').value.trim());
      return false;
    }
    msg.className = 'msg ok';
    msg.textContent = t('login.msg_login_ok');
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

async function doRegister(e) {
  e.preventDefault();
  var msg = document.getElementById('regMsg');
  var btn = document.getElementById('regBtn');
  msg.className = 'msg error';
  if (document.getElementById('regPass').value !== document.getElementById('regPass2').value) {
    msg.textContent = t('common.err_password_mismatch');
    return false;
  }
  btn.disabled = true;
  msg.textContent = t('login.msg_registering');
  try {
    var data = await api('/register', {
      method: 'POST',
      body: JSON.stringify({
        nickname: document.getElementById('regNick').value.trim(),
        password: document.getElementById('regPass').value,
        invite_code: document.getElementById('regInvite').value.trim(),
      }),
    });
    msg.className = 'msg ok';
    msg.textContent = t('login.msg_register_ok');
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

/* ---------- 邮箱注册 ---------- */

/* 发送注册验证码：purpose:'signup' = 注册场景（无需登录，服务端校验邮箱未被占用后发码） */
async function sendSignupCode() {
  var msg = document.getElementById('emailRegMsg');
  var btn = document.getElementById('emailRegSendBtn');
  var email = document.getElementById('emailRegEmail').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('common.err_email_invalid'); return; }
  btn.disabled = true;
  msg.textContent = t('common.msg_sending');
  try {
    await api('/email/code', { method: 'POST', body: JSON.stringify({ email, purpose: 'signup' }) });
    msg.className = 'msg ok';
    msg.textContent = t('common.msg_code_sent');
    document.getElementById('emailRegCodeRow').style.display = '';
    forgotCountdown(btn); // 复用找回密码的 60 秒倒计时（末态文案「重新发送验证码」）
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}

/* 提交邮箱注册：邮箱 + 验证码 + 昵称 + 密码；成功后与登录同一收尾（存会话 → 进账号中心） */
async function doEmailRegister(e) {
  e.preventDefault();
  var msg = document.getElementById('emailRegMsg');
  var btn = document.getElementById('emailRegBtn');
  msg.className = 'msg error';
  var email = document.getElementById('emailRegEmail').value.trim();
  var code = document.getElementById('emailRegCode').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('common.err_email_invalid'); return false; }
  if (!code) { msg.textContent = t('common.err_code_required'); return false; }
  if (document.getElementById('emailRegPass').value !== document.getElementById('emailRegPass2').value) {
    msg.textContent = t('common.err_password_mismatch');
    return false;
  }
  btn.disabled = true;
  msg.textContent = t('login.msg_registering');
  try {
    var data = await api('/register/email', {
      method: 'POST',
      body: JSON.stringify({
        email: email,
        code: code,
        nickname: document.getElementById('emailRegNick').value.trim(),
        password: document.getElementById('emailRegPass').value,
      }),
    });
    msg.className = 'msg ok';
    msg.textContent = t('login.msg_register_ok');
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

/* 切换到"设置密码"视图（账号密码哈希为空时）：隐藏 tabs + 各注册/登录表单，显示设密码表单 */
function showSetPassForm(nick) {
  currentView = 'setpass';
  resetAuthView();
  document.getElementById('setPassForm').style.display = '';
  document.getElementById('setPassNick').value = nick || '';
  document.getElementById('setPassNew').value = '';
  document.getElementById('setPassNew2').value = '';
  renderAuthHeader();
  var btn = document.getElementById('loginBtn'); if (btn) btn.disabled = false;
  var msg = document.getElementById('setPassMsg');
  msg.className = 'msg'; msg.textContent = '';
  document.getElementById('setPassNew').focus();
}

/* 设置密码（账号哈希为空时首次设置）：走 /api/login 并带上 new_password，后端判定空哈希账号后设密并签发会话 */
async function doSetPassword(e) {
  e.preventDefault();
  var msg = document.getElementById('setPassMsg');
  var btn = document.getElementById('setPassBtn');
  msg.className = 'msg error';
  var p1 = document.getElementById('setPassNew').value;
  var p2 = document.getElementById('setPassNew2').value;
  if (p1 !== p2) { msg.textContent = t('common.err_password_mismatch'); return false; }
  btn.disabled = true;
  msg.textContent = t('login.msg_setting');
  try {
    var data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        nickname: document.getElementById('setPassNick').value.trim(),
        new_password: p1,
      }),
    });
    msg.className = 'msg ok';
    msg.textContent = t('login.msg_set_ok');
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

/* ---------- 忘记密码 ---------- */

/* 进入「忘记密码」视图：隐藏 tabs + 其他表单，显示忘记密码表单 */
function showForgot() {
  currentView = 'forgot';
  resetAuthView();
  document.getElementById('forgotForm').style.display = '';
  renderAuthHeader();
  document.getElementById('forgotEmail').focus();
}

/* 返回登录视图：恢复 tab 栏后交给 switchTab 统一处理（含三 tab 的 active 态与标题文案） */
function backToLogin() {
  resetAuthView();
  document.querySelector('.tabs').style.display = '';
  switchTab('login');
}

/* 统一重置：隐藏 tabs 与所有表单（登录/邮箱注册/邀请码注册/设密码/忘记密码） */
function resetAuthView() {
  document.querySelector('.tabs').style.display = 'none';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('emailRegForm').style.display = 'none';
  document.getElementById('regForm').style.display = 'none';
  document.getElementById('setPassForm').style.display = 'none';
  document.getElementById('forgotForm').style.display = 'none';
}

/* 发送重置验证码：成功后显示验证码输入行 + 倒计时 */
async function sendForgotCode() {
  var msg = document.getElementById('forgotMsg');
  var btn = document.getElementById('forgotSendBtn');
  var email = document.getElementById('forgotEmail').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('common.err_email_invalid'); return; }
  btn.disabled = true;
  msg.textContent = t('common.msg_sending');
  try {
    // purpose:'reset' = 找回密码场景（无需登录，服务端按邮箱发重置码）
    await api('/email/code', { method: 'POST', body: JSON.stringify({ email, purpose: 'reset' }) });
    msg.className = 'msg ok';
    // 忽略后端返回的 msg 中文，固定用语言包文案
    msg.textContent = t('login.msg_send_ok');
    document.getElementById('forgotCodeRow').style.display = '';
    forgotCountdown(btn);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}

/* 发码按钮 60 秒倒计时；记录状态以便语言切换时重绘按钮文案 */
var countdowns = [];
function renderCountdowns() {
  countdowns.forEach(function (cd) {
    cd.btn.textContent = cd.done ? t('login.btn_resend_code') : t('login.countdown', { s: cd.left });
  });
}
function forgotCountdown(btn) {
  countdowns = countdowns.filter(function (c) { return c.btn !== btn; });
  var cd = { btn: btn, left: 60, done: false };
  countdowns.push(cd);
  renderCountdowns();
  var timer = setInterval(function () {
    cd.left--;
    if (cd.left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      cd.done = true;
    }
    renderCountdowns();
  }, 1000);
}

/* 提交重置：校验验证码与新密码，成功后等同登录 */
async function doForgotReset(e) {
  e.preventDefault();
  var msg = document.getElementById('forgotMsg');
  var btn = document.getElementById('forgotBtn');
  msg.className = 'msg error';
  var email = document.getElementById('forgotEmail').value.trim();
  var code = document.getElementById('forgotCode').value.trim();
  var p1 = document.getElementById('forgotNew').value;
  var p2 = document.getElementById('forgotNew2').value;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('common.err_email_invalid'); return; }
  if (!code) { msg.textContent = t('common.err_code_required'); return; }
  if (p1 !== p2) { msg.textContent = t('common.err_password_mismatch'); return; }
  btn.disabled = true;
  msg.textContent = t('login.msg_resetting');
  try {
    // 带 new_password → 服务端按「重置密码」处理：核销重置码、改密、撤销全部旧会话并签发新会话
    var data = await api('/email/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password: p1, new_password_confirm: p2 }),
    });
    msg.className = 'msg ok';
    msg.textContent = t('login.msg_reset_ok');
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}
/* 两个注册开关：关掉即把整个 tab 连同表单一起隐藏（统一处理，不再留「注册已暂停」的提示 + 禁用按钮）。
   隐藏只是不给死路，真正的拦截在后端（/api/register 与 /api/register/email 各自校验开关）；
   生成邀请码开关作用于账号中心取码（见 account.js），不在登录页体现 */
fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
  if (!cfg) return;
  if (cfg.inviteRegisterEnabled === false) {
    document.getElementById('tabReg').style.display = 'none';
    document.getElementById('regForm').style.display = 'none';
  }
  if (cfg.emailRegisterEnabled === false) {
    document.getElementById('tabEmailReg').style.display = 'none';
    document.getElementById('emailRegForm').style.display = 'none';
  }
}).catch(function () { /* 后端不可达时按三个开关全开处理 */ });

/* 初始化：本地已有有效会话则直接进账号中心，否则展示登录表单 */
// #authTitle / #authSubtitle 由 JS 渲染（HTML 未挂 data-i18n），首屏即按当前语言取值
renderAuthHeader();

/* 语言切换：重跑当前视图的标题/副标题，并重绘正在跑的倒计时按钮文案 */
onChange(function () {
  if (currentView === 'setpass' || currentView === 'forgot') {
    renderAuthHeader();   // 设密码 / 忘记密码视图：只重绘标题，不重跑 show（避免清空已输入的密码）
  } else {
    switchTab(currentView);
  }
  renderCountdowns();
});

autoRedirect();
