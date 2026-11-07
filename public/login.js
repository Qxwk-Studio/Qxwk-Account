// Qxwk 通行证 · 登录 / 验证码登录 / 注册 / 重置密码

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const returnTo = params.get('return_to') || '';
  const nextUrl = () => safeReturnTo(returnTo && returnTo.startsWith('/authorize') ? returnTo : '/account.html');

  const $ = (id) => document.getElementById(id);
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const forms = Array.from(document.querySelectorAll('main form'));
  const resetForm = $('resetForm');

  function showPanel(name) {
    forms.forEach((form) => {
      const panel = form.dataset.panel;
      const show = panel ? panel === name : false;
      form.classList.toggle('hidden', !show);
    });
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    const first = forms.find((f) => f.dataset.panel === name)?.querySelector('input');
    if (first) first.focus();
  }

  function showReset(show) {
    forms.forEach((form) => form.classList.add('hidden'));
    resetForm.classList.toggle('hidden', !show);
    tabs.forEach((tab) => tab.classList.remove('active'));
    if (show) $('resetEmail').focus();
  }

  function bindTabs() {
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.tab;
        showPanel(name);
      });
    });
  }

  function startCountdown(button, seconds) {
    const label = button.dataset.label || t('common.send_code');
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

  function emailOf(id) {
    return String($(id)?.value || '').trim().toLowerCase();
  }

  function bindSendButtons() {
    document.querySelectorAll('[data-send]').forEach((button) => {
      button.dataset.label = button.textContent;
      button.addEventListener('click', async () => {
        const purpose = button.dataset.send;
        const email = emailOf(button.dataset.emailFor);
        if (!email) {
          showMsg(button.closest('form').querySelector('.msg'), t('err.invalid_email'));
          return;
        }
        setBusy(button, true, t('common.sending'));
        try {
          await api('/api/auth/email/send', { method: 'POST', body: { email, purpose } });
          showMsg(button.closest('form').querySelector('.msg'), t('common.code_sent'), 'ok');
          startCountdown(button, 60);
        } catch (err) {
          showMsg(button.closest('form').querySelector('.msg'), errorText(err));
          setBusy(button, false);
        }
      });
    });
  }

  async function alreadySignedIn() {
    try {
      await api('/api/me');
      location.replace(nextUrl());
      return true;
    } catch {
      return false;
    }
  }

  function bindForms() {
    $('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      const msg = $('loginMsg');
      const account = $('loginAccount').value.trim();
      const password = $('loginPassword').value;
      if (!account) return showMsg(msg, t('err.account_required'));
      if (!password) return showMsg(msg, t('err.password_required'));
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/login', { method: 'POST', body: { account, password } });
        location.replace(nextUrl());
      } catch (err) {
        showMsg(msg, errorText(err));
        setBusy(button, false);
      }
    });

    $('codeLoginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      const msg = $('codeLoginMsg');
      const email = emailOf('codeLoginEmail');
      const code = $('codeLoginCode').value.trim();
      if (!code) return showMsg(msg, t('err.code_required'));
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/auth/email/verify', {
          method: 'POST',
          body: { email, purpose: 'login', code },
        });
        location.replace(nextUrl());
      } catch (err) {
        showMsg(msg, errorText(err));
        setBusy(button, false);
      }
    });

    $('registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      const msg = $('registerMsg');
      const email = emailOf('regEmail');
      const code = $('regCode').value.trim();
      const nickname = $('regNickname').value.trim();
      const password = $('regPassword').value;
      const password2 = $('regPassword2').value;
      if (!code) return showMsg(msg, t('err.code_required'));
      if (!nickname) return showMsg(msg, t('err.invalid_nickname'));
      if (password !== password2) return showMsg(msg, t('login.pwd_mismatch'));
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/auth/email/verify', {
          method: 'POST',
          body: { email, purpose: 'register', code, nickname, password },
        });
        location.replace(nextUrl());
      } catch (err) {
        showMsg(msg, errorText(err));
        setBusy(button, false);
      }
    });

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = e.target.querySelector('button[type="submit"]');
      const msg = $('resetMsg');
      const email = emailOf('resetEmail');
      const code = $('resetCode').value.trim();
      const newPassword = $('resetPassword').value;
      const newPassword2 = $('resetPassword2').value;
      if (!code) return showMsg(msg, t('err.code_required'));
      if (newPassword !== newPassword2) return showMsg(msg, t('login.pwd_mismatch'));
      setBusy(button, true, t('common.loading'));
      try {
        await api('/api/auth/email/verify', {
          method: 'POST',
          body: { email, purpose: 'reset_password', code, new_password: newPassword },
        });
        resetForm.reset();
        showPanel('password');
        showMsg($('loginMsg'), t('account.password_changed'), 'ok');
      } catch (err) {
        showMsg(msg, errorText(err));
        setBusy(button, false);
      }
    });

    $('forgotLink').addEventListener('click', (e) => {
      e.preventDefault();
      showReset(true);
    });
    $('backLogin').addEventListener('click', (e) => {
      e.preventDefault();
      showReset(false);
      showPanel('password');
    });
  }

  async function init() {
    bindTabs();
    bindForms();
    bindSendButtons();
    if (await alreadySignedIn()) return;
    showPanel('password');
  }

  init();
})();
