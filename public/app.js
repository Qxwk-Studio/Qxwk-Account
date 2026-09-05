// Qxwk-Account 通行证 · 共享前端逻辑：API 客户端 + 会话管理
// 复用自 CityFootprint public/app.js，localStorage key 前缀改为 qxwp_

const API_BASE = '/api';
const LS_TOKEN = 'qxwp_token';
const LS_USER = 'qxwp_user';

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = localStorage.getItem(LS_TOKEN);
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 登录态失效（token 过期/无效）：清除本地会话，回到登录页
    if (res.status === 401 && token) {
      localStorage.removeItem(LS_TOKEN);
      localStorage.removeItem(LS_USER);
      window.location.href = 'login.html';
    }
    throw new Error(data.error || '请求失败 (' + res.status + ')');
  }
  return data;
}

function saveSession(data) {
  localStorage.setItem(LS_TOKEN, data.token);
  localStorage.setItem(LS_USER, JSON.stringify({
    userId: data.userId,
    nickname: data.nickname,
    color: data.color,
    avatar: data.avatar || null,
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
  // 后端撤销会话（幂等，失败也继续清本地）
  const token = localStorage.getItem(LS_TOKEN);
  if (token) fetch('/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }).catch(() => {});
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_USER);
  window.location.href = 'login.html';
}