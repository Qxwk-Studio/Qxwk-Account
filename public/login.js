/* 登录/注册切换 */
// 表单区当前模式（登录/注册），决定标题与副标题文案
var currentAuthMode = 'login';

/* 事件绑定：CSP 去掉 script-src 'unsafe-inline' 后内联 onclick / onsubmit 会被拦下，
   故 HTML 侧改为 data-action 标记，这里用一个 document 级委托统一分发（表单直接绑 submit） */
var ACTIONS = {
  switchTab: function (ds) { switchTab(ds.mode); },
  showForgot: function () { showForgot(); },
  backToLogin: function () { backToLogin(); },
  sendForgotCode: function () { sendForgotCode(); },
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
   doLogin / doRegister / doSetPassword / doForgotReset 内部首行即 e.preventDefault()，与原来 return false 行为等价 */
document.getElementById('loginForm').addEventListener('submit', doLogin);
document.getElementById('regForm').addEventListener('submit', doRegister);
document.getElementById('setPassForm').addEventListener('submit', doSetPassword);
document.getElementById('forgotForm').addEventListener('submit', doForgotReset);

function switchTab(mode) {
  currentAuthMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabReg').classList.toggle('active', mode === 'reg');
  document.getElementById('loginForm').style.display = mode === 'login' ? '' : 'none';
  document.getElementById('regForm').style.display = mode === 'reg' ? '' : 'none';
  // 标题随模式切换（需求2）：登录↔注册各自展示对应欢迎词与副标题
  document.getElementById('authTitle').textContent = mode === 'login' ? '👋 欢迎回来' : '👋 欢迎注册';
  document.getElementById('authSubtitle').textContent = mode === 'login'
    ? '使用 Qxwk 通行证登录，一处登录，通行各站'
    : '注册一个通行证账号，一处登录，通行各站';
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
  msg.textContent = '登录中…';
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
    msg.textContent = '登录成功，正在跳转…';
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
    msg.textContent = '两次输入的密码不一致';
    return false;
  }
  btn.disabled = true;
  msg.textContent = '注册中…';
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
    msg.textContent = '注册成功，正在进入…';
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

/* 切换到"设置密码"视图（账号密码哈希为空时）：隐藏 tabs + 登录/注册表单，显示设密码表单 */
function showSetPassForm(nick) {
  document.querySelector('.tabs').style.display = 'none';
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('regForm').style.display = 'none';
  document.getElementById('setPassForm').style.display = '';
  document.getElementById('setPassNick').value = nick || '';
  document.getElementById('setPassNew').value = '';
  document.getElementById('setPassNew2').value = '';
  document.getElementById('authTitle').textContent = '🔑 设置密码';
  document.getElementById('authSubtitle').textContent = '该账号尚未设置密码，请先设置密码后登录';
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
  if (p1 !== p2) { msg.textContent = '两次输入的密码不一致'; return false; }
  btn.disabled = true;
  msg.textContent = '设置中…';
  try {
    var data = await api('/login', {
      method: 'POST',
      body: JSON.stringify({
        nickname: document.getElementById('setPassNick').value.trim(),
        new_password: p1,
      }),
    });
    msg.className = 'msg ok';
    msg.textContent = '密码设置成功，正在进入…';
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}

/* ---------- 忘记密码 ---------- */

/* 进入「忘记密码」视图：隐藏 tabs + 其他表单，显示忘记密码表单 */
function showForgot() {
  resetAuthView();
  document.getElementById('forgotForm').style.display = '';
  document.getElementById('authTitle').textContent = '🔑 忘记密码';
  document.getElementById('authSubtitle').textContent = '通过你已绑定并验证的邮箱重置密码';
  document.getElementById('forgotEmail').focus();
}

/* 返回登录视图 */
function backToLogin() {
  resetAuthView();
  currentAuthMode = 'login';
  document.querySelector('.tabs').style.display = '';
  document.getElementById('tabLogin').classList.add('active');
  document.getElementById('tabReg').classList.remove('active');
  document.getElementById('loginForm').style.display = '';
  document.getElementById('authTitle').textContent = '👋 欢迎回来';
  document.getElementById('authSubtitle').textContent = '使用 Qxwk 通行证登录，一处登录，通行各站';
}

/* 统一重置：隐藏 tabs 与所有表单（登录/注册/设密码/忘记密码） */
function resetAuthView() {
  document.querySelector('.tabs').style.display = 'none';
  document.getElementById('loginForm').style.display = 'none';
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = '请先填写正确的邮箱地址'; return; }
  btn.disabled = true;
  msg.textContent = '发送中…';
  try {
    // purpose:'reset' = 找回密码场景（无需登录，服务端按邮箱发重置码）
    var data = await api('/email/code', { method: 'POST', body: JSON.stringify({ email, purpose: 'reset' }) });
    msg.className = 'msg ok';
    msg.textContent = (data && data.msg) || '发送成功，请查收';
    document.getElementById('forgotCodeRow').style.display = '';
    forgotCountdown(btn);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
}

/* 发码按钮 60 秒倒计时 */
function forgotCountdown(btn) {
  var left = 60;
  btn.textContent = left + 's 后重发';
  var timer = setInterval(function () {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = '重新发送验证码';
    } else {
      btn.textContent = left + 's 后重发';
    }
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = '请先填写正确的邮箱地址'; return; }
  if (!code) { msg.textContent = '请输入验证码'; return; }
  if (p1 !== p2) { msg.textContent = '两次输入的密码不一致'; return; }
  btn.disabled = true;
  msg.textContent = '重置中…';
  try {
    // 带 new_password → 服务端按「重置密码」处理：核销重置码、改密、撤销全部旧会话并签发新会话
    var data = await api('/email/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, new_password: p1, new_password_confirm: p2 }),
    });
    msg.className = 'msg ok';
    msg.textContent = '密码已重置，正在登录…';
    applySession(data);
  } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  return false;
}
fetch('/api/config').then(function (r) { return r.json(); }).then(function (cfg) {
  if (cfg && cfg.inviteCodeRequired === false) {
    var field = document.getElementById('inviteField');
    var input = document.getElementById('regInvite');
    field.style.display = 'none';
    input.required = false;
  }
  if (cfg && cfg.inviteRegisterEnabled === false) {
    var notice = document.getElementById('invitePausedNotice');
    if (notice) notice.style.display = '';
    var regBtn = document.getElementById('regBtn');
    if (regBtn) regBtn.disabled = true;
  }
}).catch(function () { /* 后端不可达时默认强制邀请码 */ });

/* 初始化：本地已有有效会话则直接进账号中心，否则展示登录表单 */
autoRedirect();
