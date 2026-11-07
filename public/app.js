// Qxwk-Account 通行证 · 共享前端逻辑：API 客户端 + 会话缓存
//
// 第二版：登录态由 HttpOnly 的 qx_session Cookie 承载，前端不再保存 token。
// localStorage 只留一份用户快照（昵称/颜色/头像），用于页面首屏渲染，不作为凭证。

const API_BASE = '/api';
// 保留旧常量名，避免其他脚本引用时报未定义；新代码不再写入 token
const LS_TOKEN = 'qxwp_token';
const LS_USER = 'qxwp_user';

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(t('err.' + data.code, data.params, data.error || t('err.request_failed', { status: res.status })));
  }
  return data;
}

// 登录/注册响应统一是 { ok:true, data:{...} }；兼容旧形状
function unwrap(data) {
  return data && data.data ? data.data : data;
}

function saveSession(data) {
  const u = unwrap(data);
  if (!u) return;
  localStorage.setItem(LS_USER, JSON.stringify({
    sub: u.sub || u.userId,
    userId: u.userId || u.sub,
    nickname: u.nickname,
    color: u.color,
    email: u.email || null,
    email_verified: !!u.email_verified,
    avatar: u.avatar || null,
  }));
}

function getSession() {
  try {
    const u = localStorage.getItem(LS_USER);
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

function logout() {
  // 撤销当前 Cookie 会话（幂等，失败也继续清本地）
  fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  window.location.href = 'login.html';
}
