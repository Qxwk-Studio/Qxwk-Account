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
  document.getElementById('userUid').textContent = t('account.uid', { uid: s ? s.userId : '' });
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
// 邀请码卡最近一次渲染状态（浏览器语言切换时按此重绘，不再重新请求，避免凭空生成邀请码）
var inviteView = null;
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

// 填充修改资料表单（来自 /api/me）
async function loadProfileForm() {
  const data = await api('/me');
  document.getElementById('accNickname').value = data.nickname || '';
  document.getElementById('accEmail').value = data.email || '';
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
  // 已验证后不再显示“发送验证码”；未验证或未绑定时仍显示以便绑定
  if (sendBtn) sendBtn.style.display = (data.email && data.email_verified) ? 'none' : '';
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

// 发送验证码 → POST /api/email/code（purpose:'verify' = 绑定邮箱场景，需登录）
async function sendEmailCode() {
  const msg = document.getElementById('emailMsg');
  const btn = document.getElementById('sendCodeBtn');
  const email = document.getElementById('accEmail').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMsg(msg, 'common.err_email_invalid', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'common.msg_sending', null, 'msg error');
  try {
    await api('/email/code', { method: 'POST', body: JSON.stringify({ email, purpose: 'verify' }) });
    setMsg(msg, 'common.msg_code_sent', null, 'msg ok');
    showCodeRow(true);
    startCountdown(btn);
  } catch (err) {
    btn.disabled = false;
    setRawMsg(msg, err.message, 'msg error');
  }
}

// 校验验证码 → POST /api/email/verify
async function verifyEmailCode() {
  const msg = document.getElementById('emailMsg');
  const btn = document.getElementById('verifyCodeBtn');
  const email = document.getElementById('accEmail').value.trim();
  const code = document.getElementById('emailCode').value.trim();
  msg.className = 'msg error';
  msg.textContent = '';
  if (!email) { setMsg(msg, 'common.err_email_required', null, 'msg error'); return; }
  if (!code) { setMsg(msg, 'common.err_code_required', null, 'msg error'); return; }
  btn.disabled = true;
  setMsg(msg, 'account.msg_verifying', null, 'msg error');
  try {
    await api('/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
    setMsg(msg, 'account.msg_email_verified', null, 'msg ok');
    document.getElementById('emailCode').value = '';
    showCodeRow(false);
    // 重新拉取资料，刷新邮箱与状态徽标；头像也可能随邮箱变化
    const data = await api('/me');
    updateEmailStatus(data);
    setAvatarFromUrl(document.getElementById('profileAvatar'), data.avatar, data.nickname, data.color);
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 保存修改：昵称 + 颜色 + 邮箱 → PUT /api/profile（邮箱变更由后端重置验证状态）
async function saveProfile() {
  const msg = document.getElementById('profileMsg');
  const btn = document.getElementById('saveProfileBtn');
  const nickname = document.getElementById('accNickname').value.trim();
  const email = document.getElementById('accEmail').value.trim();
  msg.className = 'msg error';
  // 昵称校验：1-20 字符
  if (!nickname || nickname.length > 20) {
    setMsg(msg, 'err.invalid_nickname', null, 'msg error');
    return;
  }
  // 非空时必须为合法邮箱地址（不限服务商）
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMsg(msg, 'err.invalid_email', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'account.msg_saving', null, 'msg error');
  try {
    // 邮箱随资料一并保存；若变更，后端会重置验证状态，右侧需重新验证
    const body = { nickname: nickname, color: selectedColor || undefined, email: email };
    const data = await api('/profile', { method: 'PUT', body: JSON.stringify(body) });
    // 更新本地会话里的 nickname/color/avatar，供刷新后保持
    const s = getSession();
    if (s) {
      s.nickname = data.nickname;
      s.color = data.color;
      s.avatar = data.avatar || null;
      localStorage.setItem(LS_USER, JSON.stringify(s));
    }
    // 同步颜色对外展示（主卡渐变 / 大头像 / 右上色点 / 触发器）
    document.documentElement.style.setProperty('--user-color', data.color);
    updateColorUI(data.color);
    syncColorTrigger(data.color);
    document.getElementById('userColorText').textContent = t('account.user_color');
    // 昵称同步：欢迎语 + 头像回退首字
    document.getElementById('welcomeText').textContent = t('account.welcome', { name: data.nickname });
    // 邮箱/颜色/昵称可能已变更：同步刷新头像（无链接自动回退首字）
    setAvatarFromUrl(document.getElementById('profileAvatar'), data.avatar, data.nickname, data.color);
    setMsg(msg, 'account.msg_profile_saved', null, 'msg ok');
    // 邮箱若变更，后端已重置验证状态 → 刷新右侧徽章与发码按钮
    refreshEmailStatus();
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 点击"生成邀请码"：有未使用码直接显示，无则生成（一码制，防止生成过多）
async function loadInviteCode() {
  const codeEl = document.getElementById('inviteCodeText');
  const copyBtn = document.getElementById('copyInviteBtn');
  if (!codeEl) return;
  codeEl.textContent = t('common.loading');
  if (copyBtn) copyBtn.disabled = true;
  try {
    const data = await api('/invite-code');
    if (data && data.paused) {
      inviteView = { key: 'account.invite_paused', hintKey: 'account.invite_paused_hint' };
    } else if (data && data.need_email_verify) {
      // 未绑定/未验证邮箱：服务端只在「生成新码」这一步拦，已有未使用码会照常返回（见 worker.js）
      inviteView = { key: 'account.invite_need_verify', hintKey: 'account.invite_need_verify_hint' };
    } else if (data && data.code) {
      inviteView = { code: data.code, hintKey: 'account.invite_hint' };
    } else {
      inviteView = { key: 'account.invite_none', hintKey: 'account.invite_none_hint' };
    }
  } catch (err) {
    inviteView = { key: 'account.invite_failed' };
  }
  renderInvite();
}

// 按 inviteView 重绘邀请码区（语言切换时也调用，避免重新请求凭空生成邀请码）
function renderInvite() {
  var codeEl = document.getElementById('inviteCodeText');
  var copyBtn = document.getElementById('copyInviteBtn');
  var hintEl = document.getElementById('inviteHint');
  if (!codeEl || !inviteView) return;
  if (inviteView.code) {
    codeEl.textContent = inviteView.code;
    if (copyBtn) copyBtn.disabled = false;
  } else {
    codeEl.textContent = t(inviteView.key);
    if (copyBtn) copyBtn.disabled = true;
  }
  if (hintEl && inviteView.hintKey) hintEl.textContent = t(inviteView.hintKey);
}

// 复制邀请码
function copyInviteCode() {
  const codeEl = document.getElementById('inviteCodeText');
  const text = codeEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyInviteBtn');
    const old = btn.textContent;
    btn.textContent = t('account.copied');
    setTimeout(() => { btn.textContent = old; }, 1500);
  }).catch(() => alert(t('account.copy_failed')));
}

// 折叠卡：点击标题展开/收起
function toggleCard(id) {
  document.getElementById(id).classList.toggle('open');
}

// 修改密码：新密码 → PUT /api/password（凭登录态直接改）
async function changePassword() {
  const msg = document.getElementById('pwdMsg');
  const btn = document.getElementById('changePwdBtn');
  const newP = document.getElementById('newPassword').value;
  const newP2 = document.getElementById('newPassword2').value;
  msg.className = 'msg error';
  if (!newP || !newP2) {
    setMsg(msg, 'account.err_all_fields', null, 'msg error');
    return;
  }
  if (newP !== newP2) {
    setMsg(msg, 'account.err_new_password_mismatch', null, 'msg error');
    return;
  }
  if (newP.length < 4 || newP.length > 50) {
    setMsg(msg, 'err.invalid_new_password', null, 'msg error');
    return;
  }
  btn.disabled = true;
  setMsg(msg, 'account.msg_changing', null, 'msg error');
  try {
    await api('/password', { method: 'PUT', body: JSON.stringify({ new_password: newP }) });
    setMsg(msg, 'account.msg_password_updated', null, 'msg ok');
    document.getElementById('newPassword').value = '';
    document.getElementById('newPassword2').value = '';
  } catch (err) {
    setRawMsg(msg, err.message, 'msg error');
  } finally {
    btn.disabled = false;
  }
}

// 登录设备：只列「直连登录」的会话（服务端已过滤 client_id 为空的行，并解析 UA 成「系统 · 浏览器」）
// 从第三方站点带来源标识登录的会话归「已授权网站」卡，不在这里重复出现
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

// 已授权网站：服务端按来源聚合出「本账号在这些站点/应用各有几处登录」
// 覆盖「不是在本站直接登录」的全部会话：已登记站点（有站点名/origin）+ 未登记来源（名字是调用方
// 自报的原始串，服务端给 unregistered=true，这里标成「未登记来源」）+ 已移出白名单的站点（「已移除的站点」）
// 每个来源只有「注销登录」一个动作：一次撤销本账号在该来源的**全部会话**（该处需重新登录）。
// 不提供逐台设备下线 —— 来源是用户能理解的最小单位，逐台下线在「这是谁的登录」上说不清
// 在本站直接登录的设备（来源两列皆空）归「登录设备」卡，两张卡不重不漏
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
      // 来源副标题：已登记站点显示 origin；未登记来源 / 已移除站点没有 origin，改成显式标注——
      // 既不渲染出 "null"，也提醒用户这个名字是调用方自报的，不可当权威
      // account.src_unregistered 已自带尾部 ' · '，故未登记来源不再另拼
      var src = c.unregistered ? t('account.src_unregistered') : (c.origin ? escapeHtml(c.origin) + ' · ' : '');
      var meta = t('account.client_meta', { src: src, count: c.session_count, last: fmtDateTime(c.last_seen_at) });
      // 行的形状与「登录设备」卡一致：左 .main 里第一行站点名、第二行灰字说明，右侧是注销按钮
      return '<div class="session-item">'
        + '<div class="main">'
        + '<div class="dev"><span class="dot"></span>' + escapeHtml(c.name) + '</div>'
        + '<div class="meta">' + meta + '</div>'
        + '</div>'
        // c.id 对已登记站点是 apps.id（数字），对未登记来源是原始串（字符串），所以必须转义后再放进属性
        + '<button class="btn btn-ghost btn-sm" data-action="revokeClient" data-id="' + escapeHtml(String(c.id)) + '">' + t('account.btn_revoke_client') + '</button>'
        + '</div>';
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
    setMsg(msg, 'account.revoked_clients', { n: data.revoked }, 'msg ok');
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
  copyInviteCode: function () { copyInviteCode(); },
  loadInviteCode: function () { loadInviteCode(); },
  revokeOtherSessions: function () { revokeOtherSessions(); },
  // id 为服务端整数 rowid / apps 主键，从 data-id 取回后用 Number 还原，不拼字符串、不 eval
  revokeSession: function (ds, el) { revokeSession(Number(el.dataset.id)); },
  revokeClient: function (ds, el) { revokeClient(Number(el.dataset.id)); },
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

// 每次访问时验证本地凭证：加载期间显示加载界面，校验完再决定进账号中心还是未登录界面
if (getSession()) {
  api('/me')
    .then(function (data) {
      if (data && data.created_at) {
        var s = String(data.created_at);
        var d = new Date(s.replace(' ', 'T'));
        // 只存原始值，格式化交给 fmtRegDate()（语言切换时需按当前语言重新格式化）
        if (isNaN(d.getTime())) { window._regDate = null; window._regRaw = s.slice(0, 10); }
        else { window._regDate = d; window._regRaw = ''; }
      }
      // 同步本地会话的 avatar（邮箱变更后 avatar 会更新；老用户本地无此字段时补齐）
      var local = getSession();
      if (local) {
        local.avatar = data.avatar || null;
        localStorage.setItem(LS_USER, JSON.stringify(local));
      }
      enterUserView(data.avatar);
      loadProfileForm();
      loadSessions();
      loadClients();
      // 显示邀请码卡片（空态：点击"生成邀请码"才请求后端，不随页面自动生成）
      var inviteCard = document.getElementById('inviteCodeCard');
      if (inviteCard) inviteCard.style.display = '';
    })
    .catch(function () {
      // token 失效：app.js 的 401 处理已清除本地会话并跳登录页；其余失败回未登录界面
      showAuthView();
    });
} else {
  // 无本地会话：直接展示未登录界面，无需请求
  showAuthView();
}

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
    renderInvite();                    // 邀请码区（按最近一次状态重绘，不重新请求）
    renderCountdown();                 // 发码按钮倒计时文案
  }
  refreshMsgs();                       // 已显示的 msg
});
