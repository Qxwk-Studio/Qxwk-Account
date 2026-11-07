// 直接使用头像链接（由 /api/me 返回的 avatar 字段）设置头像；
// 无链接或图片加载失败时，回退为昵称首字 + 专属颜色
function setAvatarFromUrl(el, avatarUrl, nickname, color) {
  function fallback() {
    el.textContent = (nickname || '?').charAt(0).toUpperCase();
    el.style.background = color || 'var(--primary)';
    el.style.boxShadow = '0 6px 20px ' + (color || '#2563eb') + '55';
  }
  if (!avatarUrl) { fallback(); return; }
  var img = document.createElement('img');
  img.src = avatarUrl;
  img.alt = t('account.avatar_alt', { name: nickname || t('account.user_fallback') });
  img.referrerPolicy = 'no-referrer';
  img.onerror = fallback;
  el.textContent = '';
  el.style.background = 'var(--bg)';   // 占位底色（图片加载中/透明时）
  el.style.boxShadow = '0 6px 20px ' + (color || '#2563eb') + '55';
  el.appendChild(img);
}

// 展示未登录界面（无会话，或会话校验失败）
function showAuthView() {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('authView').style.display = '';
}

function enterUserView(avatarUrl) {
  document.getElementById('loadingView').style.display = 'none';
  document.getElementById('authView').style.display = 'none';
  document.getElementById('mainContent').style.display = '';
  var s = getSession();
  // 专属颜色驱动主卡渐变
  if (s && s.color) document.documentElement.style.setProperty('--user-color', s.color);
  document.getElementById('welcomeText').textContent = t('account.welcome', { name: s ? s.nickname : '' });
  document.getElementById('userUid').textContent = t('account.uid', { uid: s ? (s.sub || s.userId) : '' });
  // 大头像：直接使用会话或接口返回的头像链接，加载失败回退昵称首字 + 专属颜色
  var avatar = document.getElementById('profileAvatar');
  if (avatar) setAvatarFromUrl(avatar, avatarUrl || (s && s.avatar), s ? s.nickname : '', s ? s.color : '#2563eb');
  var colorDot = document.getElementById('userColor');
  if (colorDot && s && s.color) {
    colorDot.style.background = s.color;
    colorDot.style.boxShadow = '0 0 0 3px ' + s.color + '40';
  }
  document.getElementById('userColorText').textContent = t('account.user_color');
  var regEl = document.getElementById('userRegTime');
  if (regEl && (window._regDate || window._regRaw)) regEl.textContent = t('account.reg_time', { date: fmtRegDate() });
}

// 60 种 Material 调色板（与 src/lib.js USER_COLORS 一致）
const USER_COLORS = [
  '#dc2626', '#ef4444', '#f87171', '#ea580c', '#f97316', '#b45309', '#fb923c', '#fdba74', '#d97706', '#f59e0b',
  '#fbbf24', '#eab308', '#fcd34d', '#facc15', '#fde047', '#d9f99d', '#a3e635', '#84cc16', '#65a30d', '#86efac',
  '#4ade80', '#22c55e', '#16a34a', '#6ee7b7', '#34d399', '#10b981', '#99f6e4', '#2dd4bf', '#14b8a6', '#a5f3fc',
  '#22d3ee', '#06b6d4', '#0891b2', '#38bdf8', '#0ea5e9', '#bae6fd', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb',
  '#818cf8', '#6366f1', '#4f46e5', '#a78bfa', '#8b5cf6', '#7c3aed', '#d8b4fe', '#c084fc', '#a855f7', '#f0abfc',
  '#e879f9', '#d946ef', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#f43f5e', '#fb7185', '#fda4af',
];

// 当前选中的颜色（保存按钮提交用）；null = 尚未在色板点选
let selectedColor = null;

// ===== 语言切换（onChange）所需的状态 =====
// 注册日期原始值：解析成功存 Date，失败存原始串；fmtRegDate() 据此按语言格式化
window._regDate = null;
window._regRaw = '';
// 发码按钮倒计时状态（语言切换时重绘按钮文案）
var countdownEl = null, countdownLeft = 0, countdownDone = false;

// msg 元素当前对应的语言包 key：语言切换时按新语言重绘；
// 后端返回的 err.message 等外部文案无 key（key 为空），不参与重绘
function setMsg(el, key, params, cls) {
  el.className = cls || 'msg';
  el.dataset.i18nKey = key;
  el.dataset.i18nParams = params ? JSON.stringify(params) : '';
  el.textContent = t(key, params);
}
function setRawMsg(el, text, cls) {
  el.className = cls || 'msg';
  el.dataset.i18nKey = '';
  el.dataset.i18nParams = '';
  el.textContent = text;
}
function refreshMsgs() {
  document.querySelectorAll('.msg[data-i18n-key]').forEach(function (el) {
    var key = el.dataset.i18nKey;
    if (!key) return;
    var params = el.dataset.i18nParams ? JSON.parse(el.dataset.i18nParams) : undefined;
    el.textContent = t(key, params);
  });
}

// 渲染色板浮层：current 为已有颜色，对其高亮 .active
function renderColorPicker(current) {
  const grid = document.getElementById('colorMenuGrid');
  selectedColor = current || null;
  grid.innerHTML = USER_COLORS.map(function (hex) {
    return '<div class="swatch' + (hex === current ? ' active' : '') + '" role="button" tabindex="0" style="background:' + hex + '" data-color="' + hex + '" data-action="pickColor"></div>';
  }).join('');
  syncColorTrigger(current);
}

// 同步颜色触发器的圆点与文案（仅修改资料表单内的局部预览，不影响上方展示）
function syncColorTrigger(hex) {
  const dot = document.getElementById('colorPreviewDot');
  const label = document.getElementById('colorPreviewLabel');
  if (hex && dot) dot.style.background = hex;
  if (label) label.textContent = hex ? hex.toUpperCase() : t('account.color_placeholder');
}

// 点选色块：仅记录选中值 + 更新色板高亮 / 触发器局部预览
// 上方主卡渐变 / 大头像 / 右上色点留待「保存修改」成功后才更新
function pickColor(hex) {
  selectedColor = hex;
  document.querySelectorAll('#colorMenuGrid .swatch').forEach(function (el) {
    el.classList.toggle('active', el.dataset.color === hex);
  });
  syncColorTrigger(hex);
  // 点选后收起浮层
  toggleColorMenu(null, true);
}

// 颜色浮层展开/收起：openForce 为 true 时强制关闭
function toggleColorMenu(event, openForce) {
  const field = document.querySelector('.color-field');
  const trigger = document.getElementById('colorTrigger');
  const willOpen = openForce === true ? false : (openForce === false ? true : !field.classList.contains('open'));
  field.classList.toggle('open', willOpen);
  trigger.classList.toggle('open', willOpen);
  if (event) event.stopPropagation();
}

// 更新主卡渐变 / 大头像 / 右上色点
function updateColorUI(hex) {
  if (!hex) return;
  const avatar = document.getElementById('profileAvatar');
  if (avatar) {
    avatar.style.background = hex;
    avatar.style.boxShadow = '0 6px 20px ' + hex + '55';
  }
  const dot = document.getElementById('userColor');
  if (dot) {
    dot.style.background = hex;
    dot.style.boxShadow = '0 0 0 3px ' + hex + '40';
  }
}


// 折叠卡 / 颜色浮层：点击外部关闭
document.addEventListener('click', function (e) {
  const field = document.querySelector('.color-field');
  if (field && !field.contains(e.target)) {
    field.classList.remove('open');
    const t = document.getElementById('colorTrigger');
    if (t) t.classList.remove('open');
  }
});

// 填充修改资料表单。data 由启动时的 /api/me 结果直接传入——本函数原先自己再 await api('/me')，
// 与启动校验那一次完全重复，白白多出一趟串行往返（账号中心的加载转圈因此翻倍）
// profile 下拉框：已有选项优先；历史值不在列表里时补一个 option，避免显示为空
function setSelectValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const v = value || '';
  if (v && !Array.from(el.options).some((o) => o.value === v)) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  }
  el.value = v;
}

function loadProfileForm(data) {
  document.getElementById('accNickname').value = data.nickname || '';
  document.getElementById('accEmail').value = data.email || '';
  setSelectValue('accLocale', data.locale);
  setSelectValue('accZoneinfo', data.zoneinfo);
  document.getElementById('accWebsite').value = data.website || '';
  renderColorPicker(data.color);
  syncColorTrigger(data.color);
  // 用服务端的最新颜色驱动主卡渐变（仅在初始化时设置，选色阶段不更新）
  if (data.color) document.documentElement.style.setProperty('--user-color', data.color);
  // 邮箱验证状态徽标
  updateEmailStatus(data);
}

// 刷新邮箱验证状态徽标（data 来自 /api/me）：仅“已验证 / 未验证”徽章
function updateEmailStatus(data) {
  var ver = document.getElementById('emailStatusVer');
  var verT = document.getElementById('emailStatusVerText');
  var sendBtn = document.getElementById('sendCodeBtn');
  // 验证徽章：未绑定邮箱时显示“未验证”占位，但发码按钮仍允许发码绑定
  if (ver) {
    if (data.email && data.email_verified) {
      ver.className = 'email-status ok';
      if (verT) verT.textContent = t('account.email_verified');
    } else {
      ver.className = 'email-status pending';
      if (verT) verT.textContent = t('account.email_unverified');
    }
  }
  // 已验证或无邮箱时不再显示「发送验证码」；无邮箱请走下方「更换邮箱」
  if (sendBtn) sendBtn.style.display = (!data.email || data.email_verified) ? 'none' : '';
}

// 重新拉取最新资料，仅刷新邮箱状态徽章与发码按钮（改邮箱/验证后调用）
async function refreshEmailStatus() {
  try {
    const data = await api('/me');
    updateEmailStatus(data);
  } catch (e) { /* 拉取失败则忽略 */ }
}

// 显示/隐藏验证码输入行
function showCodeRow(show) {
  var row = document.getElementById('codeRow');
  if (row) row.classList.toggle('show', show);
}

// 发码按钮倒计时；状态记录在模块级变量，语言切换时可按新语言重绘
function renderCountdown() {
  if (!countdownEl) return;
  countdownEl.textContent = countdownDone ? t('account.btn_send_code') : t('account.countdown', { s: countdownLeft });
}
function startCountdown(btn) {
  countdownEl = btn;
  countdownLeft = 60;
  countdownDone = false;
  renderCountdown();
  var timer = setInterval(function () {
    countdownLeft--;
    if (countdownLeft <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      countdownDone = true;
    }
    renderCountdown();
  }, 1000);
}

// 发送验证码 → POST /api/me/email/send（purpose:'verify_email'，发到当前已绑定邮箱）
async function sendEmailCode() {
  const msg = document.getElementById('emailMsg');
  const btn = document.getElementById('sendCodeBtn');
  const current = getSession() || {};
  msg.className = 'msg error';
  msg.textContent = '';
  if (!current.email) {
    setMsg(msg, 'common.err_email_required', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'common.msg_sending', null, 'msg error');
  try {
    await api('/me/email/send', { method: 'POST', body: JSON.stringify({ purpose: 'verify_email' }) });
    setMsg(msg, 'common.msg_code_sent', null, 'msg ok');
    showCodeRow(true);
    startCountdown(btn);
  } catch (err) {
    btn.disabled = false;
    setRawMsg(msg, err.message, 'msg error');
  }
}

// 校验邮箱验证码 → POST /api/me/email/verify（purpose:'verify_email'）
async function verifyEmailCode() {
  const msg = document.getElementById('emailMsg');
  const btn = document.getElementById('verifyCodeBtn');
  const code = document.getElementById('emailCode').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!code) { setMsg(msg, 'common.err_code_required', null, 'msg error'); return; }
  btn.disabled = true;
  setMsg(msg, 'account.msg_verifying', null, 'msg error');
  try {
    await api('/me/email/verify', { method: 'POST', body: JSON.stringify({ purpose: 'verify_email', code }) });
    setMsg(msg, 'account.msg_email_verified', null, 'msg ok');
    document.getElementById('emailCode').value = '';
    showCodeRow(false);
    const data = await api('/me');
    updateEmailStatus(data);
    loadProfileForm(data);
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 更换邮箱：先发码（需当前密码），再核销
async function sendChangeEmailCode() {
  const msg = document.getElementById('changeEmailMsg');
  const btn = document.getElementById('changeEmailSendBtn');
  const newEmail = document.getElementById('changeEmail').value.trim();
  const password = document.getElementById('changeEmailPass').value;
  msg.className = 'msg error';
  msg.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    setRawMsg(msg, t('common.err_email_invalid'), 'msg error');
    return;
  }
  if (!password) { setMsg(msg, 'common.err_password_required', null, 'msg error'); return; }
  btn.disabled = true;
  setMsg(msg, 'common.msg_sending', null, 'msg error');
  try {
    await api('/me/email/send', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'change_email', new_email: newEmail, password }),
    });
    setMsg(msg, 'common.msg_code_sent', null, 'msg ok');
    document.getElementById('changeEmailCodeRow').style.display = 'flex';
    startCountdown(btn);
  } catch (err) {
    btn.disabled = false;
    setRawMsg(msg, err.message, 'msg error');
  }
}

async function changeEmail() {
  const msg = document.getElementById('changeEmailMsg');
  const btn = document.getElementById('changeEmailBtn');
  const code = document.getElementById('changeEmailCode').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!code) { setMsg(msg, 'common.err_code_required', null, 'msg error'); return; }
  btn.disabled = true;
  setMsg(msg, 'account.msg_verifying', null, 'msg error');
  try {
    await api('/me/email/verify', { method: 'POST', body: JSON.stringify({ purpose: 'change_email', code }) });
    setMsg(msg, 'account.msg_email_verified', null, 'msg ok');
    document.getElementById('changeEmail').value = '';
    document.getElementById('changeEmailPass').value = '';
    document.getElementById('changeEmailCode').value = '';
    document.getElementById('changeEmailCodeRow').style.display = 'none';
    const data = await api('/me');
    updateEmailStatus(data);
    loadProfileForm(data);
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 保存修改：昵称 + 颜色 → PATCH /api/me（邮箱在邮箱卡走验证流程，不在这里改）
async function saveProfile() {
  const msg = document.getElementById('profileMsg');
  const btn = document.getElementById('saveProfileBtn');
  const nickname = document.getElementById('accNickname').value.trim();
  msg.className = 'msg error';
  if (!nickname || nickname.length > 20) {
    setMsg(msg, 'err.invalid_nickname', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'account.msg_saving', null, 'msg error');
  try {
    const data = await api('/me', {
      method: 'PATCH',
      body: JSON.stringify({
        nickname,
        color: selectedColor || undefined,
        locale: document.getElementById('accLocale').value,
        zoneinfo: document.getElementById('accZoneinfo').value,
        website: document.getElementById('accWebsite').value.trim(),
      }),
    });
    loadProfileForm(data);
    // 更新本地快照
    const s = getSession() || {};
    s.nickname = data.nickname;
    s.color = data.color;
    s.avatar = data.avatar || null;
    localStorage.setItem(LS_USER, JSON.stringify(s));
    document.documentElement.style.setProperty('--user-color', data.color);
    updateColorUI(data.color);
    syncColorTrigger(data.color);
    document.getElementById('userColorText').textContent = t('account.user_color');
    document.getElementById('welcomeText').textContent = t('account.welcome', { name: data.nickname });
    setAvatarFromUrl(document.getElementById('profileAvatar'), data.avatar, data.nickname, data.color);
    setMsg(msg, 'account.msg_profile_saved', null, 'msg ok');
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 折叠卡：点击标题展开/收起
function toggleCard(id) {
  document.getElementById(id).classList.toggle('open');
}

// 修改密码：原密码 + 新密码 → POST /api/me/password（其他设备会被下线）
async function changePassword() {
  const msg = document.getElementById('pwdMsg');
  const btn = document.getElementById('changePwdBtn');
  const oldP = document.getElementById('oldPassword').value;
  const newP = document.getElementById('newPassword').value;
  const newP2 = document.getElementById('newPassword2').value;
  msg.className = 'msg error';
  if (!oldP || !newP || !newP2) {
    setMsg(msg, 'account.err_all_fields', null, 'msg error');
    return;
  }
  if (newP !== newP2) {
    setMsg(msg, 'account.err_new_password_mismatch', null, 'msg error');
    return;
  }
  if (newP.length < 8 || newP.length > 128) {
    setMsg(msg, 'err.invalid_new_password', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'account.msg_changing', null, 'msg error');
  try {
    await api('/me/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldP, new_password: newP }),
    });
    setMsg(msg, 'account.msg_password_updated', null, 'msg ok');
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newPassword2').value = '';
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 登录设备：服务端返回 qx_session 会话，UA 已解析成「系统 · 浏览器」
async function loadSessions() {
  var list = document.getElementById('sessionList');
  if (!list) return;
  try {
    var data = await api('/sessions');
    if (!data.sessions || !data.sessions.length) {
      list.innerHTML = '<div class="empty">' + t('account.no_sessions') + '</div>';
      return;
    }
    list.innerHTML = data.sessions.map(function (s) {
      var meta = t('account.session_meta', { last: fmtDateTime(s.last_seen_at), created: fmtDateTime(s.created_at) });
      var right = s.current
        ? '<span class="badge-current">' + t('account.badge_current') + '</span>'
        // s.id 为服务端返回的整数 rowid，作为 data-id 交给委托取值（无字符串注入风险）
        : '<button class="btn btn-ghost btn-sm" data-action="revokeSession" data-id="' + s.id + '">' + t('account.btn_revoke') + '</button>';
      return '<div class="session-item' + (s.current ? ' current' : '') + '">'
        + '<div class="main"><div class="dev"><span class="dot"></span>' + escapeHtml(s.device) + '</div>'
        + '<div class="meta">' + meta + '</div></div>' + right + '</div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty">' + t('common.err_load_failed') + '</div>';
  }
}

// 下线单个设备
async function revokeSession(id) {
  var msg = document.getElementById('sessionMsg');
  setMsg(msg, 'common.msg_processing', null, 'msg');
  try {
    await api('/sessions/revoke', { method: 'POST', body: JSON.stringify({ id: id }) });
    setMsg(msg, 'account.msg_session_revoked', null, 'msg ok');
    // 两个卡都可能调用本函数（设备卡 / 站点展开后的设备行），故两张都刷新
    loadSessions();
    loadClients();
  } catch (e) {
    setRawMsg(msg, e.message, 'msg error');
  }
}

// 下线除当前设备外的全部设备
async function revokeOtherSessions() {
  var msg = document.getElementById('sessionMsg');
  setMsg(msg, 'common.msg_processing', null, 'msg');
  try {
    var data = await api('/sessions/revoke-others', { method: 'POST' });
    setMsg(msg, data.revoked ? 'account.revoked_others' : 'account.no_other_sessions',
      data.revoked ? { n: data.revoked } : undefined, 'msg ok');
    loadSessions();
  } catch (e) {
    setRawMsg(msg, e.message, 'msg error');
  }
}

// 已授权应用：数据来自 oauth_grants（user_id × client_id）
// revoked = 用户撤销过；撤销后下次 /authorize 会出确认页，重新授权后才恢复
async function loadClients() {
  var list = document.getElementById('clientList');
  if (!list) return;
  try {
    var data = await api('/clients');
    if (!data.clients || !data.clients.length) {
      list.innerHTML = '<div class="empty">' + t('account.no_clients') + '</div>';
      return;
    }
    list.innerHTML = data.clients.map(function (c) {
      var src = c.revoked ? (t('account.badge_revoked') + ' · ') : '';
      var meta = t('account.client_meta', { src: src, count: c.revoked ? 0 : 1, last: fmtDateTime(c.last_seen_at) });
      var right = c.revoked
        ? '<span class="badge-current">' + t('account.badge_revoked') + '</span>'
        : '<button class="btn btn-ghost btn-sm" data-action="revokeClient" data-id="' + escapeHtml(String(c.id)) + '">' + t('account.btn_revoke_client') + '</button>';
      return '<div class="session-item' + (c.revoked ? ' revoked' : '') + '">'
        + '<div class="main"><div class="dev"><span class="dot"></span>' + escapeHtml(c.name) + '</div>'
        + '<div class="meta">' + meta + '</div></div>' + right + '</div>';
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty">' + t('common.err_load_failed') + '</div>';
  }
}

// 注销某网站的登录：撤销本账号在该站点的全部会话（该网站里需重新登录）
async function revokeClient(id) {
  var msg = document.getElementById('clientMsg');
  setMsg(msg, 'common.msg_processing', null, 'msg');
  try {
    var data = await api('/clients/revoke', { method: 'POST', body: JSON.stringify({ id: id }) });
    setMsg(msg, 'account.revoked_clients', { n: 1 }, 'msg ok');
    loadClients();
  } catch (e) {
    setRawMsg(msg, e.message, 'msg error');
  }
}

function escapeHtml(t) {
  var d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}

// 登录时间显示：数据库存 UTC，转本地时区后截到分钟（中文保持 YYYY-MM-DD HH:MM，英文走 Intl）
function fmtDateTime(v) {
  if (!v) return '';
  var s = String(v).replace('T', ' ');  // 'YYYY-MM-DD HH:MM:SS'（UTC）
  var d = new Date(s.replace(' ', 'T') + 'Z');  // 按 UTC 解析
  if (isNaN(d.getTime())) return s.slice(0, 16);
  if (getLang() === 'en') return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  var p = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// 注册日期显示：中文保持「X年X月X日」手拼原格式，英文走 Intl.DateTimeFormat
function fmtRegDate() {
  var d = window._regDate;
  if (!d) return window._regRaw;
  if (getLang() === 'en') return new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/* 事件绑定：CSP 去掉 script-src 'unsafe-inline' 后内联 onclick 会被拦下，
   HTML 侧（含上面 loadSessions / loadClients / renderColorPicker 动态拼接的按钮）改带 data-action，
   这里用一个 document 级委托统一分发。 */
var ACTIONS = {
  goLogin: function () { location.href = 'login.html'; },
  toggleColorMenu: function (ds, el, e) { toggleColorMenu(e); },
  pickColor: function (ds) { pickColor(ds.color); },
  saveProfile: function () { saveProfile(); },
  sendEmailCode: function () { sendEmailCode(); },
  verifyEmailCode: function () { verifyEmailCode(); },
  toggleCard: function (ds) { toggleCard(ds.card); },
  changePassword: function () { changePassword(); },
  revokeOtherSessions: function () { revokeOtherSessions(); },
  // id 是 UUID 字符串，直接透传，不能 Number()
  revokeSession: function (ds, el) { revokeSession(el.dataset.id); },
  revokeClient: function (ds, el) { revokeClient(el.dataset.id); },
  sendChangeEmailCode: function () { sendChangeEmailCode(); },
  changeEmail: function () { changeEmail(); },
  logout: function () { logout(); },
};
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset, el, e);
});
// 注：toggleColorMenu 原先靠按钮内联处理器里的 stopPropagation 拦住冒泡，现在委托本身就在 document 上、
// stopPropagation 已不起作用；但上方「点色板外部关闭」的判断是 field.contains(e.target)，
// 点在触发器或色板内部时同样不会关闭浮层，故行为等价。

// 每次访问都用 Cookie 会话校验：成功进账号中心，401 回未登录界面
api('/me')
  .then(function (data) {
    if (data && data.created_at) {
      var s = String(data.created_at);
      var d = new Date(s.replace(' ', 'T'));
      if (isNaN(d.getTime())) { window._regDate = null; window._regRaw = s.slice(0, 10); }
      else { window._regDate = d; window._regRaw = ''; }
    }
    // 同步本地快照的 UUID（sub）与头像（邮箱变更后 avatar 会更新）
    var local = getSession() || {};
    local.sub = data.sub || data.userId;
    local.userId = local.sub;
    local.nickname = data.nickname;
    local.color = data.color;
    local.email = data.email || null;
    local.avatar = data.avatar || null;
    localStorage.setItem(LS_USER, JSON.stringify(local));

    enterUserView(data.avatar);
    loadProfileForm(data);
    loadSessions();
    loadClients();
  })
  .catch(function () {
    showAuthView();
  });

/* 语言切换：重绘所有随语言变化的动态文案。
   已渲染的列表 innerHTML（设备 / 授权网站）、倒计时按钮、已显示的 msg 都必须在此重跑，否则停在旧语言 */
onChange(function () {
  var s = getSession();
  if (s) {
    document.getElementById('welcomeText').textContent = t('account.welcome', { name: s.nickname });
    document.getElementById('userUid').textContent = t('account.uid', { uid: s.userId });
    document.getElementById('userColorText').textContent = t('account.user_color');
    var regEl = document.getElementById('userRegTime');
    if (regEl && (window._regDate || window._regRaw)) regEl.textContent = t('account.reg_time', { date: fmtRegDate() });
    syncColorTrigger(selectedColor);   // 颜色触发器文案
    refreshEmailStatus();              // 邮箱状态徽标（重新拉取 /me）
    loadSessions();                    // 登录设备列表
    loadClients();                     // 已授权网站列表
    renderCountdown();                 // 发码按钮倒计时文案
  }
  refreshMsgs();                       // 已显示的 msg
});
