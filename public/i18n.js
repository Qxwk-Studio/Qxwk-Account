// Qxwk 通行证 · 前端国际化（简体中文 / English）
//
// 必须在 <head> 里同步加载：英文访客首屏前先隐藏 body，避免中文原文闪一帧。
// 中文包是唯一真源，英文缺项时回退中文。

(function () {
  'use strict';

  var KEY = 'lang';
  var root = document.documentElement;

  var PACKS = {
    zh: {
      'common.loading': '加载中…',
      'common.sending': '发送中…',
      'common.save': '保存',
      'common.cancel': '取消',
      'common.confirm': '确定',
      'common.logout': '退出登录',
      'common.theme': '切换主题',
      'common.lang': '切换语言',
      'common.send_code': '获取验证码',
      'common.resend': '重新发送',
      'common.code_sent': '验证码已发送，请查收',
      'common.back': '返回',
      'common.copy': '2026 青翔未阔工作室 · Qxwk 通行证',
      'common.slogan': '一处登录，通行各站',
      'common.none': '无',

      'login.title': '登录 - Qxwk 通行证',
      'login.sub': '用一个通行证账号，登录所有 Qxwk 站点。',
      'login.tab_password': '登录',
      'login.tab_code': '验证码登录',
      'login.tab_register': '注册',
      'login.account': '昵称或邮箱',
      'login.account_ph': '输入昵称或邮箱',
      'login.password': '密码',
      'login.password_ph': '输入密码',
      'login.submit': '登录',
      'login.forgot': '忘记密码？',
      'login.no_account': '还没有账号？',
      'login.go_register': '注册一个',
      'login.email': '邮箱',
      'login.email_ph': 'you@example.com',
      'login.code': '验证码',
      'login.code_ph': '6 位数字',
      'login.nickname': '昵称',
      'login.nickname_ph': '1-20 个字符',
      'login.confirm_password': '确认密码',
      'login.new_password': '新密码',
      'login.pwd_mismatch': '两次输入的密码不一致',
      'login.register_submit': '创建账号',
      'login.code_login_submit': '验证并登录',
      'login.reset_title': '重置密码',
      'login.reset_sub': '通过已绑定的邮箱重置密码。',
      'login.reset_submit': '重置密码',
      'login.back_login': '返回登录',
      'login.hint': '密码只提交给 Qxwk 通行证，不经过第三方站点。',
      'login.welcome': 'Qxwk 通行证',
      'login.remember': '登录后可在账号中心管理邮箱、密码与登录设备。',

      'account.title': '账号中心 - Qxwk 通行证',
      'account.sub': '管理你的通行证资料、安全设置与授权。',
      'account.profile': '个人资料',
      'account.nickname': '昵称',
      'account.color': '专属颜色',
      'account.save_profile': '保存资料',
      'account.email': '邮箱',
      'account.verified': '已验证',
      'account.unverified': '未验证',
      'account.password': '修改密码',
      'account.old_password': '原密码',
      'account.new_password': '新密码',
      'account.confirm_password': '确认新密码',
      'account.change_password': '修改密码',
      'account.email_card': '邮箱',
      'account.email_hint': '邮箱用于验证码登录与找回密码。',
      'account.send_verify': '发送验证码',
      'account.verify_now': '验证邮箱',
      'account.change_email': '更换邮箱',
      'account.new_email': '新邮箱',
      'account.email_password': '当前密码',
      'account.sessions': '登录设备',
      'account.sessions_hint': '这些设备正使用你的通行证。',
      'account.revoke': '下线',
      'account.revoke_others': '下线其他设备',
      'account.current': '当前设备',
      'account.last_seen': '最后活跃',
      'account.created_at': '登录时间',
      'account.grants': '已授权应用',
      'account.grants_hint': '这些应用获得过你的身份授权。',
      'account.revoke_app': '注销登录',
      'account.revoked': '已撤销',
      'account.no_grants': '还没有应用使用你的通行证。',
      'account.no_sessions': '没有其他登录设备。',
      'account.saved': '已保存',
      'account.password_changed': '密码已修改，其他设备已下线',
      'account.email_sent': '验证码已发送',
      'account.email_verified': '邮箱已验证',
      'account.email_changed': '邮箱已更换',
      'account.session_revoked': '已下线',
      'account.app_revoked': '已注销该应用的登录',
      'account.confirm_revoke': '确定要下线这个设备吗？',
      'account.confirm_revoke_app': '确定要注销这个应用的登录吗？',

      'err.request_failed': '请求失败（HTTP {status}）',
      'err.network': '网络连接失败，请稍后重试',
      'err.unauthorized': '登录已失效，请重新登录',
      'err.invalid_credentials': '帐号或密码不正确',
      'err.login_locked': '登录失败次数过多，请稍后再试',
      'err.rate_limited': '操作过于频繁，请 {minutes} 分钟后再试',
      'err.invalid_code': '验证码错误或已过期',
      'err.code_required': '请输入验证码',
      'err.invalid_email': '请输入正确的邮箱地址',
      'err.temp_email_not_allowed': '不支持临时邮箱，请使用常用邮箱',
      'err.email_taken': '该邮箱已被使用',
      'err.nickname_taken': '昵称已被占用',
      'err.invalid_nickname': '昵称需为 1-20 个字符',
      'err.invalid_password': '密码需为 8-128 个字符，且不能是常见弱密码',
      'err.same_password': '新密码不能与原密码相同',
      'err.email_required': '请先绑定邮箱',
      'err.already_verified': '邮箱已验证',
      'err.email_unavailable': '邮件服务暂不可用',
      'err.forbidden_origin': '请求来源不合法',
      'err.invalid_purpose': '不支持的用途',
      'err.not_found': '记录不存在',
      'err.account_required': '请填写昵称或邮箱',
      'err.password_required': '请填写密码',
      'err.invalid_profile': '资料格式不正确',
    },
    en: {
      'common.loading': 'Loading…',
      'common.sending': 'Sending…',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'common.logout': 'Sign out',
      'common.theme': 'Toggle theme',
      'common.lang': 'Switch language',
      'common.send_code': 'Send code',
      'common.resend': 'Resend',
      'common.code_sent': 'Code sent, please check your inbox',
      'common.back': 'Back',
      'common.copy': '2026 Qingxiang Weikuo Studio · Qxwk Passport',
      'common.slogan': 'One login, everywhere',
      'common.none': 'None',

      'login.title': 'Sign in - Qxwk Passport',
      'login.sub': 'One passport account for every Qxwk site.',
      'login.tab_password': 'Sign in',
      'login.tab_code': 'Email code',
      'login.tab_register': 'Register',
      'login.account': 'Nickname or email',
      'login.account_ph': 'Enter nickname or email',
      'login.password': 'Password',
      'login.password_ph': 'Enter password',
      'login.submit': 'Sign in',
      'login.forgot': 'Forgot password?',
      'login.no_account': 'No account yet?',
      'login.go_register': 'Create one',
      'login.email': 'Email',
      'login.email_ph': 'you@example.com',
      'login.code': 'Verification code',
      'login.code_ph': '6 digits',
      'login.nickname': 'Nickname',
      'login.nickname_ph': '1-20 characters',
      'login.confirm_password': 'Confirm password',
      'login.new_password': 'New password',
      'login.pwd_mismatch': 'Passwords do not match',
      'login.register_submit': 'Create account',
      'login.code_login_submit': 'Verify and sign in',
      'login.reset_title': 'Reset password',
      'login.reset_sub': 'Reset via your verified email.',
      'login.reset_submit': 'Reset password',
      'login.back_login': 'Back to sign in',
      'login.hint': 'Your password is sent only to Qxwk Passport, never to third-party sites.',
      'login.welcome': 'Qxwk Passport',
      'login.remember': 'After signing in you can manage email, password and devices in the account center.',

      'account.title': 'Account - Qxwk Passport',
      'account.sub': 'Manage your profile, security and authorizations.',
      'account.profile': 'Profile',
      'account.nickname': 'Nickname',
      'account.color': 'Accent color',
      'account.save_profile': 'Save profile',
      'account.email': 'Email',
      'account.verified': 'Verified',
      'account.unverified': 'Unverified',
      'account.password': 'Change password',
      'account.old_password': 'Current password',
      'account.new_password': 'New password',
      'account.confirm_password': 'Confirm new password',
      'account.change_password': 'Change password',
      'account.email_card': 'Email',
      'account.email_hint': 'Used for email-code sign-in and password recovery.',
      'account.send_verify': 'Send code',
      'account.verify_now': 'Verify email',
      'account.change_email': 'Change email',
      'account.new_email': 'New email',
      'account.email_password': 'Current password',
      'account.sessions': 'Signed-in devices',
      'account.sessions_hint': 'These devices are using your passport.',
      'account.revoke': 'Sign out',
      'account.revoke_others': 'Sign out other devices',
      'account.current': 'This device',
      'account.last_seen': 'Last active',
      'account.created_at': 'Signed in',
      'account.grants': 'Authorized apps',
      'account.grants_hint': 'Apps that have received your identity.',
      'account.revoke_app': 'Revoke',
      'account.revoked': 'Revoked',
      'account.no_grants': 'No app is using your passport yet.',
      'account.no_sessions': 'No other devices.',
      'account.saved': 'Saved',
      'account.password_changed': 'Password changed, other devices signed out',
      'account.email_sent': 'Code sent',
      'account.email_verified': 'Email verified',
      'account.email_changed': 'Email changed',
      'account.session_revoked': 'Signed out',
      'account.app_revoked': 'App authorization revoked',
      'account.confirm_revoke': 'Sign out this device?',
      'account.confirm_revoke_app': 'Revoke this app?',

      'err.request_failed': 'Request failed (HTTP {status})',
      'err.network': 'Network error, please retry',
      'err.unauthorized': 'Session expired, please sign in again',
      'err.invalid_credentials': 'Incorrect account or password',
      'err.login_locked': 'Too many failed attempts, try again later',
      'err.rate_limited': 'Too many requests, try again in {minutes} minutes',
      'err.invalid_code': 'Invalid or expired code',
      'err.code_required': 'Enter the verification code',
      'err.invalid_email': 'Enter a valid email address',
      'err.temp_email_not_allowed': 'Disposable email addresses are not allowed',
      'err.email_taken': 'This email is already in use',
      'err.nickname_taken': 'This nickname is taken',
      'err.invalid_nickname': 'Nickname must be 1-20 characters',
      'err.invalid_password': 'Password must be 8-128 characters and not a common one',
      'err.same_password': 'New password must differ from the current one',
      'err.email_required': 'Bind an email first',
      'err.already_verified': 'Email already verified',
      'err.email_unavailable': 'Email service is temporarily unavailable',
      'err.forbidden_origin': 'Invalid request origin',
      'err.invalid_purpose': 'Unsupported purpose',
      'err.not_found': 'Not found',
      'err.account_required': 'Enter nickname or email',
      'err.password_required': 'Enter password',
      'err.invalid_profile': 'Invalid profile data',
    },
  };

  function readLang() {
    try {
      return localStorage.getItem(KEY) === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  var lang = readLang();
  if (lang === 'en') root.setAttribute('data-i18n-pending', '');

  function t(key, params, fallback) {
    var pack = PACKS[lang] || {};
    var zh = PACKS.zh || {};
    var value = pack[key] !== undefined ? pack[key] : (zh[key] !== undefined ? zh[key] : fallback);
    if (value === undefined) value = key;
    if (params) {
      value = String(value).replace(/\{(\w+)\}/g, function (_, name) {
        return params[name] !== undefined ? params[name] : '{' + name + '}';
      });
    }
    return value;
  }

  var listeners = [];

  function applyI18n(scope) {
    var host = scope || document;
    var nodes = host.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      el.textContent = t(el.getAttribute('data-i18n'), null, el.textContent);
    }
    var ph = host.querySelectorAll('[data-i18n-placeholder]');
    for (var j = 0; j < ph.length; j++) {
      ph[j].setAttribute('placeholder', t(ph[j].getAttribute('data-i18n-placeholder')));
    }
    var aria = host.querySelectorAll('[data-i18n-aria-label]');
    for (var k = 0; k < aria.length; k++) {
      aria[k].setAttribute('aria-label', t(aria[k].getAttribute('data-i18n-aria-label')));
    }
    var titles = host.querySelectorAll('[data-i18n-title]');
    for (var m = 0; m < titles.length; m++) {
      titles[m].setAttribute('title', t(titles[m].getAttribute('data-i18n-title')));
    }
    root.removeAttribute('data-i18n-pending');
    for (var n = 0; n < listeners.length; n++) {
      try { listeners[n](lang); } catch { /* 单个页面回调失败不影响其他 */ }
    }
  }

  function syncToggle() {
    var btn = document.getElementById('langToggle');
    if (!btn) return;
    btn.textContent = lang === 'en' ? '中' : 'EN';
    btn.setAttribute('title', t('common.lang'));
    btn.setAttribute('aria-label', t('common.lang'));
  }

  function setLang(next) {
    lang = next === 'en' ? 'en' : 'zh';
    try { localStorage.setItem(KEY, lang); } catch { /* ignore */ }
    root.lang = lang === 'en' ? 'en' : 'zh-CN';
    syncToggle();
    applyI18n();
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  document.addEventListener('DOMContentLoaded', function () {
    syncToggle();
    applyI18n();
    var btn = document.getElementById('langToggle');
    if (btn) {
      btn.addEventListener('click', function () {
        setLang(lang === 'zh' ? 'en' : 'zh');
      });
    }
  });

  window.addEventListener('storage', function (e) {
    if (e.key === KEY) {
      lang = readLang();
      syncToggle();
      applyI18n();
    }
  });

  root.lang = lang === 'en' ? 'en' : 'zh-CN';
  window.t = t;
  window.applyI18n = applyI18n;
  window.getLang = function () { return lang; };
  window.setLang = setLang;
  window.onChange = onChange;
})();
