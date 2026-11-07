// Qxwk 通行证 · 账号中心

(function () {
  'use strict';

  const USER_COLORS = [
    '#dc2626', '#ef4444', '#f87171', '#ea580c', '#f97316', '#b45309', '#fb923c', '#fdba74', '#d97706', '#f59e0b',
    '#fbbf24', '#eab308', '#fcd34d', '#facc15', '#fde047', '#d9f99d', '#a3e635', '#84cc16', '#65a30d', '#86efac',
    '#4ade80', '#22c55e', '#16a34a', '#6ee7b7', '#34d399', '#10b981', '#99f6e4', '#2dd4bf', '#14b8a6', '#a5f3fc',
    '#22d3ee', '#06b6d4', '#0891b2', '#38bdf8', '#0ea5e9', '#bae6fd', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb',
    '#818cf8', '#6366f1', '#4f46e5', '#a78bfa', '#8b5cf6', '#7c3aed', '#d8b4fe', '#c084fc', '#a855f7', '#f0abfc',
    '#e879f9', '#d946ef', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#f43f5e', '#fb7185', '#fda4af',
  ];

  const $ = (id) => document.getElementById(id);
  const state = { me: null, sessions: [], clients: [] };

  function startCountdown(button, seconds) {
    const label = button.dataset.label || button.textContent;
    let left = seconds;
    button.disabled = true;
    button.textContent = `${left}s`;
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = label;
      } else {
        button.textContent = `${left}s`;
      }
    }, 1000);
  }

  function renderProfile() {
    const me = state.me;
    if (!me) return;
    renderAvatar($('avatar'), me);
    $('profileName').textContent = me.nickname || '—';
    $('profileEmail').textContent = me.email || t('common.none');
    $('nickname').value = me.nickname || '';
    $('colorInput').value = me.color || USER_COLORS[0];
    renderColorDots();

    const badge = $('emailBadge');
    if (!me.email) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
      badge.classList.toggle('warn', !me.email_verified);
      badge.textContent = me.email_verified ? t('account.verified') : t('account.unverified');
    }
    renderEmail();
  }

  function renderColorDots() {
    const host = $('colorDots');
    host.textContent = '';
    const selected = $('colorInput').value;
    USER_COLORS.forEach((color) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'color-dot' + (color === selected ? ' selected' : '');
      dot.style.background = color;
      dot.setAttribute('aria-label', color);
      dot.addEventListener('click', () => {
        $('colorInput').value = color;
        Array.from(host.children).forEach((el) => el.classList.toggle('selected', el === dot));
      });
      host.appendChild(dot);
    });
  }

  function renderEmail() {
    const me = state.me;
    if (!me) return;
    $('emailValue').textContent = me.email || t('common.none');
    const badge = $('emailState');
    if (!me.email) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
      badge.classList.toggle('warn', !me.email_verified);
      badge.textContent = me.email_verified ? t('account.verified') : t('account.unverified');
    }
    $('verifyBlock').classList.toggle('hidden', !(me.email && !me.email_verified));
  }

  function renderSessions() {
    const host = $('sessionsList');
    host.textContent = '';
    if (!state.sessions.length) {
      host.innerHTML = `<p class="list-empty">${t('account.no_sessions')}</p>`;
      return;
    }
    state.sessions.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const grow = document.createElement('div');
      grow.className = 'grow';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = s.device;
      if (s.current) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.style.marginLeft = '8px';
        badge.textContent = t('account.current');
        title.appendChild(badge);
      }
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${t('account.last_seen')}: ${fmtDate(s.last_seen_at || s.created_at)}`;
      grow.append(title, sub);
      item.appendChild(grow);
      if (!s.current) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger btn-sm';
        btn.type = 'button';
        btn.textContent = t('account.revoke');
        btn.addEventListener('click', async () => {
          if (!confirm(t('account.confirm_revoke'))) return;
          try {
            await api('/api/sessions/revoke', { method: 'POST', body: { id: s.id } });
            showMsg($('sessionsMsg'), t('account.session_revoked'), 'ok');
            await loadSessions();
          } catch (err) {
            showMsg($('sessionsMsg'), errorText(err));
          }
        });
        item.appendChild(btn);
      }
      host.appendChild(item);
    });
  }

  function renderClients() {
    const host = $('grantsList');
    host.textContent = '';
    if (!state.clients.length) {
      host.innerHTML = `<p class="list-empty">${t('account.no_grants')}</p>`;
      return;
    }
    state.clients.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'list-item';
      const grow = document.createElement('div');
      grow.className = 'grow';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = c.name;
      if (c.revoked) {
        const badge = document.createElement('span');
        badge.className = 'badge warn';
        badge.style.marginLeft = '8px';
        badge.textContent = t('account.revoked') || '已撤销';
        title.appendChild(badge);
      }
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `${t('account.last_seen')}: ${fmtDate(c.last_seen_at)}`;
      grow.append(title, sub);
      item.appendChild(grow);
      if (!c.revoked) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger btn-sm';
        btn.type = 'button';
        btn.textContent = t('account.revoke_app');
        btn.addEventListener('click', async () => {
          if (!confirm(t('account.confirm_revoke_app'))) return;
          try {
            await api('/api/clients/revoke', { method: 'POST', body: { id: c.id } });
            showMsg($('grantsMsg'), t('account.app_revoked'), 'ok');
            await loadClients();
          } catch (err) {
            showMsg($('grantsMsg'), errorText(err));
          }
        });
        item.appendChild(btn);
      }
      host.appendChild(item);
    });
  }

  async function loadSessions() {
    try {
      const data = await api('/api/sessions');
      state.sessions = data.sessions || [];
      renderSessions();
    } catch (err) {
      if (err.status === 401) location.replace('/login.html');
    }
  }

  async function loadClients() {
    try {
      const data = await api('/api/clients');
      state.clients = data.clients || [];
      renderClients();
    } catch (err) {
      if (err.status === 401) location.replace('/login.html');
    }
  }

  async function refreshMe() {
    state.me = await api('/api/me');
    renderProfile();
  }

  function bindProfile() {
    $('profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      setBusy(button, true, t('common.loading'));
      try {
        state.me = await api('/api/me', {
          method: 'PATCH',
          body: { nickname: $('nickname').value.trim(), color: $('colorInput').value },
        });
        renderProfile();
        showMsg($('profileMsg'), t('account.saved'), 'ok');
      } catch (err) {
        showMsg($('profileMsg'), errorText(err));
      } finally {
        setBusy(button, false);
      }
    });
  }

  function bindPassword() {
    $('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      const msg = $('passwordMsg');
      const oldPassword = $('oldPassword').value;
      const newPassword = $('newPassword').value;
      const confirmPassword = $('newPassword2').value;
      if (newPassword !== confirmPassword) return showMsg(msg, t('login.pwd_mismatch'));
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/me/password', {
          method: 'POST',
          body: { old_password: oldPassword, new_password: newPassword },
        });
        e.target.reset();
        showMsg(msg, t('account.password_changed'), 'ok');
      } catch (err) {
        showMsg(msg, errorText(err));
      } finally {
        setBusy(button, false);
      }
    });
  }

  function bindEmail() {
    $('verifySend').addEventListener('click', async () => {
      const button = $('verifySend');
      setBusy(button, true, t('common.sending'));
      try {
        await api('/api/me/email/send', { method: 'POST', body: { purpose: 'verify_email' } });
        showMsg($('emailMsg'), t('account.email_sent'), 'ok');
        startCountdown(button, 60);
      } catch (err) {
        showMsg($('emailMsg'), errorText(err));
        setBusy(button, false);
      }
    });

    $('verifyBtn').addEventListener('click', async () => {
      const button = $('verifyBtn');
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/me/email/verify', {
          method: 'POST',
          body: { purpose: 'verify_email', code: $('verifyCode').value.trim() },
        });
        await refreshMe();
        showMsg($('emailMsg'), t('account.email_verified'), 'ok');
      } catch (err) {
        showMsg($('emailMsg'), errorText(err));
      } finally {
        setBusy(button, false);
      }
    });

    $('changeSend').addEventListener('click', async () => {
      const button = $('changeSend');
      const password = $('changePassword').value;
      const newEmail = $('changeEmail').value.trim();
      if (!password) return showMsg($('emailMsg'), t('err.password_required'));
      if (!newEmail) return showMsg($('emailMsg'), t('err.invalid_email'));
      setBusy(button, true, t('common.sending'));
      try {
        await api('/api/me/email/send', {
          method: 'POST',
          body: { purpose: 'change_email', password, new_email: newEmail },
        });
        showMsg($('emailMsg'), t('account.email_sent'), 'ok');
        startCountdown(button, 60);
      } catch (err) {
        showMsg($('emailMsg'), errorText(err));
        setBusy(button, false);
      }
    });

    $('changeBtn').addEventListener('click', async () => {
      const button = $('changeBtn');
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/me/email/verify', {
          method: 'POST',
          body: { purpose: 'change_email', code: $('changeCode').value.trim() },
        });
        $('changePassword').value = '';
        $('changeEmail').value = '';
        $('changeCode').value = '';
        await refreshMe();
        showMsg($('emailMsg'), t('account.email_changed'), 'ok');
      } catch (err) {
        showMsg($('emailMsg'), errorText(err));
      } finally {
        setBusy(button, false);
      }
    });
  }

  function bindSessions() {
    $('revokeOthers').addEventListener('click', async () => {
      try {
        await api('/api/sessions/revoke-others', { method: 'POST', body: {} });
        showMsg($('sessionsMsg'), t('account.session_revoked'), 'ok');
        await loadSessions();
      } catch (err) {
        showMsg($('sessionsMsg'), errorText(err));
      }
    });
  }

  function bindLogout() {
    $('logoutBtn').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch { /* 本地照样跳走 */ }
      location.replace('/login.html');
    });
  }

  async function init() {
    bindProfile();
    bindPassword();
    bindEmail();
    bindSessions();
    bindLogout();

    try {
      state.me = await api('/api/me');
    } catch (err) {
      location.replace('/login.html');
      return;
    }
    renderProfile();
    await Promise.all([loadSessions(), loadClients()]);

    onChange(() => {
      renderProfile();
      renderSessions();
      renderClients();
    });
  }

  init();
})();
