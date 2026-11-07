// Qxwk 通行证 · 前端 API 客户端（Cookie 会话）
//
// 登录态完全由 HttpOnly 的 qx_session Cookie 承载，前端不存 token。
// 所有请求默认 credentials: 'same-origin'，写操作统一 JSON。

const JSON_HEADERS = { 'Content-Type': 'application/json' };

class ApiError extends Error {
  constructor(message, status, code, params) {
    super(message);
    this.status = status;
    this.code = code;
    this.params = params || null;
  }
}

async function api(path, options = {}) {
  const { method = 'GET', body, headers } = options;
  const init = {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { ...JSON_HEADERS, ...(headers || {}) } : (headers || {}),
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(t('err.network'), 0, 'network');
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || t('err.request_failed', { status: res.status });
    throw new ApiError(message, res.status, data.code, data.params);
  }
  return data;
}

// 错误信息优先用后端的 code 查语言包，查不到再回退后端中文
function errorText(err) {
  if (!err) return t('err.request_failed', { status: '?' });
  if (err.code) {
    const key = 'err.' + err.code;
    const localized = t(key, err.params, '');
    if (localized && localized !== key) return localized;
  }
  return err.message || t('err.request_failed', { status: err.status || '?' });
}

function showMsg(el, message, kind = 'error') {
  if (!el) return;
  el.textContent = message || '';
  el.className = 'msg' + (message ? ' ' + kind : '');
}

function fmtDate(value) {
  if (!value) return '';
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeReturnTo(raw) {
  const s = String(raw || '');
  if (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) return s;
  return '/account.html';
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText || t('common.loading');
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

// 头像：有 URL 用图片，否则「昵称首字 + 专属颜色」
function renderAvatar(el, user) {
  if (!el || !user) return;
  el.textContent = '';
  el.style.background = user.color || 'var(--primary)';
  if (user.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      el.textContent = String(user.nickname || '?').slice(0, 1).toUpperCase();
    };
    el.appendChild(img);
  } else {
    el.textContent = String(user.nickname || '?').slice(0, 1).toUpperCase();
  }
}

window.api = api;
window.ApiError = ApiError;
window.errorText = errorText;
window.showMsg = showMsg;
window.fmtDate = fmtDate;
window.safeReturnTo = safeReturnTo;
window.setBusy = setBusy;
window.renderAvatar = renderAvatar;
