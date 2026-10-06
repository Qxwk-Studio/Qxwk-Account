// Qxwk-Account 通行证 · 网页国际化（简体中文 / 英文）
//
// 本文件必须在 <head> 里用**同步** <script src> 加载（不加 defer）：
//   1) 首屏前必须已知当前语言，才能在非中文访客下先隐藏 body、避免 HTML 原文（中文）闪一帧；
//   2) 切换按钮在 <body> 里，head 同步执行时还解析不到，故沿用 theme.js 的「轮询等元素出现再绑」写法。
//
// 两份语言包（zh 原文 / en）都常驻同一文件：即时切换要求两包都在手边，
// 拆成 lang/*.js 反而要在 head 里动态插 script，徒增闪烁与复杂度。
//
// zh 包是唯一真源：applyI18n() 对中文访客也会执行（用于把 data-i18n 标注回填为原文），
// 故 zh 各条目必须与 HTML 原文 / 后端 error 中文字段逐字一致，不一致会悄悄改写中文界面。
//
// 品牌名 `Qxwk 通行证` / `青翔未阔工作室` / `Qxwk` 不译，语言包里不为其单列 key（含它们的
// 复合文案如页脚、<title> 也在中英文两侧保持原名不改写）。
(function () {
  'use strict';

  var KEY = 'lang';
  var root = document.documentElement;

  // ============================ 语言包 ============================
  var PACKS = {
    zh: {
      // ---- 公共 / navbar / 页脚 ----
      'brand.slogan': '一处登录，通行各站',
      'common.switch_theme': '切换主题',
      'common.switch_lang': '切换语言',
      'common.iframe_welcome': '欢迎',
      'footer.copy': '2026 青翔未阔工作室 · Qxwk 通行证',

      // ---- 前端通用提示（login.js / account.js 共用）----
      'common.msg_sending': '发送中…',
      'common.msg_processing': '处理中…',
      'common.msg_code_sent': '验证码已发送，10 分钟内有效，请查收',
      'common.err_email_invalid': '请先填写正确的邮箱地址',
      'common.err_email_required': '请先填写邮箱',
      'common.err_code_required': '请输入验证码',
      'common.err_password_mismatch': '两次输入的密码不一致',
      'common.loading': '加载中…',
      'common.err_load_failed': '加载失败，请稍后重试',

      // ---- 登录页：静态文案 ----
      'login.title': '登录 - 青翔未阔工作室',
      'login.description': '登录 Qxwk 账号通行证，一处登录，通行各站。',
      'login.tab_login': '登录',
      'login.tab_email_reg': '邮箱注册',
      'login.tab_reg': '邀请码注册',
      'login.label_nick_email': '昵称 / 邮箱',
      'login.ph_nick_email': '昵称或已绑定的邮箱',
      'login.label_password': '密码',
      'login.ph_password': '密码',
      'login.btn_login': '登录',
      'login.forgot_link': '忘记密码？',
      'login.label_email': '邮箱',
      'login.ph_email_reg': '用于登录与找回密码的邮箱',
      'login.btn_send_code': '发送验证码',
      'login.label_code': '验证码',
      'login.ph_code': '6 位验证码',
      'login.label_nickname': '昵称',
      'login.ph_nickname': '1-20 个字符',
      'login.label_pass': '密码',
      'login.ph_pass': '4-50 个字符',
      'login.label_confirm': '确认密码',
      'login.ph_confirm': '再输入一次',
      'login.btn_register': '注册并登录',
      'login.label_invite': '邀请码',
      'login.ph_invite': '请输入邀请码',
      'login.hint_invite': '邀请码：找已注册的朋友要一个，一个邀请码只能注册一次',
      'login.label_new_password': '新密码',
      'login.label_confirm_new_password': '确认新密码',
      'login.btn_set_password': '设置密码并登录',
      'login.label_bound_email': '绑定邮箱',
      'login.ph_bound_email': '你已绑定并验证的邮箱',
      'login.btn_send_reset_code': '发送验证码到该邮箱',
      'login.btn_reset_password': '重置密码并登录',
      'login.back_to_login': '← 返回登录',

      // ---- 登录页：JS 动态文案（login.js 调用，经 onChange 重渲染）----
      'login.welcome_title': '👋 欢迎回来',
      'login.welcome_subtitle': '使用 Qxwk 通行证登录，一处登录，通行各站',
      'login.email_reg_title': '📮 邮箱注册',
      'login.email_reg_subtitle': '用邮箱验证码注册一个通行证账号，注册后邮箱即为已验证',
      'login.reg_title': '🎟️ 邀请码注册',
      'login.reg_subtitle': '凭一次性邀请码注册一个通行证账号',
      'login.set_password_title': '🔑 设置密码',
      'login.set_password_subtitle': '该账号尚未设置密码，请先设置密码后登录',
      'login.forgot_title': '🔑 忘记密码',
      'login.forgot_subtitle': '通过你已绑定并验证的邮箱重置密码',
      'login.msg_logging_in': '登录中…',
      'login.msg_login_ok': '登录成功，正在跳转…',
      'login.msg_registering': '注册中…',
      'login.msg_register_ok': '注册成功，正在进入…',
      'login.msg_setting': '设置中…',
      'login.msg_set_ok': '密码设置成功，正在进入…',
      'login.msg_resetting': '重置中…',
      'login.msg_reset_ok': '密码已重置，正在登录…',
      'login.msg_send_ok': '发送成功，请查收',
      'login.countdown': '{s}s 后重发',
      'login.btn_resend_code': '重新发送验证码',

      // ---- 账号中心：静态文案 ----
      'account.title': '账号中心 - 青翔未阔工作室',
      'account.description': 'Qxwk 账号通行证 · 账号中心，查看统一账号信息、管理登录设备与已授权网站。',
      'account.loading': '正在加载账号信息…',
      'account.not_logged_title': '你还没有登录',
      'account.not_logged_subtitle': '登录后才能查看你的通行证账号信息',
      'account.btn_go_login': '去登录 / 注册',
      'account.page_title': '账号中心',
      'account.profile_edit_title': '✏️ 修改个人资料',
      'account.label_nickname': '昵称',
      'account.ph_nickname': '1-20 个字符',
      'account.hint_nickname': '昵称是你在各站展示的名字，修改后所有接入站点都会同步',
      'account.label_color': '专属颜色',
      'account.hint_color': '点击弹出调色板，选择你的专属颜色',
      'account.color_menu_title': '选择专属颜色',
      'account.label_email': '邮箱',
      'account.ph_email': '选填，如 you@example.com',
      'account.hint_email': '仅 QQ 邮箱（@qq.com）可获得头像',
      'account.btn_save': '保存修改',
      'account.email_card_title': '📧 邮箱验证',
      'account.email_subtitle': '验证你的邮箱以使用完整功能',
      'account.btn_send_verify': '发送验证码至填写的邮箱',
      'account.ph_code': '6 位验证码',
      'account.btn_verify': '验证绑定',
      'account.pwd_card_title': '🔒 重置密码',
      'account.label_new_password': '新密码',
      'account.ph_new_password': '4-50 个字符',
      'account.label_confirm_new_password': '确认新密码',
      'account.ph_confirm_new_password': '再次输入新密码',
      'account.btn_change_password': '修改密码',
      'account.invite_title': '🎫 邀请好友',
      'account.btn_copy': '复制',
      'account.btn_generate': '生成邀请码',
      'account.session_title': '💻 登录设备',
      'account.btn_revoke_others': '下线其他所有设备',
      'account.client_title': '🌐 已授权网站',
      'account.logout_title': '退出登录',
      'account.logout_tip': '退出后在本站需重新登录，其他设备不受影响',
      'account.btn_logout': '退出登录',

      // ---- 账号中心：JS 动态文案（account.js 调用，经 onChange 重渲染）----
      'account.welcome': '{name}，欢迎回来 👋',
      'account.uid': 'UID：{uid}',
      'account.user_color': '专属颜色',
      'account.reg_time': '注册于 {date}',
      'account.avatar_alt': '{name} 的头像',
      'account.user_fallback': '用户',
      'account.color_placeholder': '点击选择专属颜色',
      'account.email_verified': '已验证',
      'account.email_unverified': '未验证',
      'account.msg_verifying': '验证中…',
      'account.msg_email_verified': '绑定成功，邮箱已验证 ✔',
      'account.msg_saving': '保存中…',
      'account.msg_profile_saved': '资料已更新 ✔',
      'account.invite_paused': '邀请码生成已暂停',
      'account.invite_paused_hint': '管理员已暂停邀请码生成，暂无法获取邀请码',
      'account.invite_need_verify': '需先验证邮箱',
      'account.invite_need_verify_hint': '绑定并验证邮箱后才能生成邀请码；已有未使用的邀请码仍会显示',
      'account.invite_hint': '分享给朋友注册用，一个码只能注册一次',
      'account.invite_none': '暂无可用邀请码',
      'account.invite_none_hint': '点击「生成邀请码」创建一个',
      'account.invite_failed': '获取失败',
      'account.copied': '已复制 ✅',
      'account.copy_failed': '复制失败，请手动复制',
      'account.err_new_password_mismatch': '两次输入的新密码不一致',
      'account.err_all_fields': '请填写所有字段',
      'account.msg_changing': '修改中…',
      'account.msg_password_updated': '密码已更新 ✔',
      'account.no_sessions': '暂无直接登录的设备',
      'account.session_meta': '最后活跃 {last} · 登录于 {created}',
      'account.badge_current': '当前设备',
      'account.btn_revoke': '下线',
      'account.revoked_others': '已下线其他 {n} 台设备 ✔',
      'account.no_other_sessions': '没有其他已登录设备',
      'account.msg_session_revoked': '该设备已下线 ✔',
      'account.src_unregistered': '未登记来源 · ',
      'account.client_meta': '{src}{count} 处登录 · 最近活跃 {last}',
      'account.no_clients': '暂无来自其他网站或应用的登录',
      'account.btn_revoke_client': '注销登录',
      'account.revoked_clients': '已注销 {n} 处登录 ✔',
      'account.countdown': '{s}s 重试',
      'account.btn_send_code': '发送验证码',

      // ---- 路由根页 ----
      'index.title': 'Qxwk 通行证',
      'index.description': 'Qxwk 账号通行证 —— 青翔未阔工作室统一账号中心。',
      'index.checking': '正在检查登录状态…',

      // ---- 后端错误码（code 与 src/worker.js 逐字对应；error 中文字段为遗留透传）----
      'err.code_too_frequent': '发送太频繁，请稍后再试',
      'err.code_ip_daily_limit': '今日发送次数过多，请明天再试',
      'err.code_email_daily_limit': '该邮箱今日发送次数过多，请明天再试',
      'err.code_too_many_attempts': '验证码错误次数过多，请重新获取验证码',
      'err.invalid_code': '验证码错误或已过期',
      'err.invalid_nickname': '昵称需为 1-20 个字符',
      'err.invalid_password': '密码需为 4-50 个字符',
      'err.register_paused': '注册已暂停，暂不接受新注册',
      'err.nickname_taken': '昵称已被占用，换一个吧',
      'err.invite_code_required': '请填写邀请码',
      'err.invalid_invite_code': '邀请码无效或已被使用',
      'err.invalid_email': '请输入正确的邮箱地址',
      'err.code_required': '请输入验证码',
      'err.temp_email_not_allowed': '不支持临时邮箱，请使用常用邮箱',
      'err.email_taken': '该邮箱已注册，请直接登录或找回密码',
      'err.unauthorized': '未登录',
      'err.invite_generate_failed': '邀请码生成失败，请重试',
      'err.account_required': '请填写昵称或邮箱',
      'err.login_locked': '登录失败次数过多，请 {minutes} 分钟后再试',
      'err.invalid_credentials': '帐号或密码不正确',
      'err.password_required': '请填写密码',
      'err.user_not_found': '用户不存在',
      'err.invalid_color': '颜色无效，请从预置色板中选择',
      'err.email_service_unavailable': '邮件服务未配置，请联系管理员',
      'err.email_not_verified': '该邮箱未验证',
      'err.email_send_failed': '邮件发送失败，请稍后重试',
      'err.invalid_new_password': '新密码需为 4-50 个字符',
      'err.password_mismatch': '两次输入的密码不一致',
      'err.email_already_bound': '该邮箱已被其他账号绑定',
      'err.new_password_required': '请填写新密码',
      'err.invalid_params': '参数无效',
      'err.session_not_found': '设备不存在或为当前设备',
      'err.client_not_found': '该来源没有活跃登录',
      'err.not_found': '接口不存在',
      'err.request_failed': '请求失败 ({status})'
    },

    en: {
      // ---- common / navbar / footer ----
      'brand.slogan': 'One login, all sites',
      'common.switch_theme': 'Switch theme',
      'common.switch_lang': 'Switch language',
      'common.iframe_welcome': 'Welcome',
      'footer.copy': '2026 青翔未阔工作室 · Qxwk 通行证',

      // ---- shared front-end messages ----
      'common.msg_sending': 'Sending…',
      'common.msg_processing': 'Processing…',
      'common.msg_code_sent': 'Verification code sent; valid for 10 minutes. Please check your inbox',
      'common.err_email_invalid': 'Please enter a valid email address first',
      'common.err_email_required': 'Please enter your email first',
      'common.err_code_required': 'Please enter the verification code',
      'common.err_password_mismatch': 'The two passwords do not match',
      'common.loading': 'Loading…',
      'common.err_load_failed': 'Failed to load, please try again later',

      // ---- login page: static ----
      'login.title': 'Sign in - 青翔未阔工作室',
      'login.description': 'Sign in to your Qxwk account pass — one login, all sites.',
      'login.tab_login': 'Sign in',
      'login.tab_email_reg': 'Email sign-up',
      'login.tab_reg': 'Invite sign-up',
      'login.label_nick_email': 'Nickname / Email',
      'login.ph_nick_email': 'Nickname or bound email',
      'login.label_password': 'Password',
      'login.ph_password': 'Password',
      'login.btn_login': 'Sign in',
      'login.forgot_link': 'Forgot password?',
      'login.label_email': 'Email',
      'login.ph_email_reg': 'Email used for sign-in and password recovery',
      'login.btn_send_code': 'Send code',
      'login.label_code': 'Code',
      'login.ph_code': '6-digit code',
      'login.label_nickname': 'Nickname',
      'login.ph_nickname': '1-20 characters',
      'login.label_pass': 'Password',
      'login.ph_pass': '4-50 characters',
      'login.label_confirm': 'Confirm password',
      'login.ph_confirm': 'Enter it again',
      'login.btn_register': 'Sign up and sign in',
      'login.label_invite': 'Invite code',
      'login.ph_invite': 'Enter invite code',
      'login.hint_invite': 'Invite code: ask a registered friend for one; each code can only be used once',
      'login.label_new_password': 'New password',
      'login.label_confirm_new_password': 'Confirm new password',
      'login.btn_set_password': 'Set password and sign in',
      'login.label_bound_email': 'Bound email',
      'login.ph_bound_email': 'Your bound and verified email',
      'login.btn_send_reset_code': 'Send code to this email',
      'login.btn_reset_password': 'Reset password and sign in',
      'login.back_to_login': '← Back to sign in',

      // ---- login page: dynamic ----
      'login.welcome_title': '👋 Welcome back',
      'login.welcome_subtitle': 'Sign in with your Qxwk account pass — one login, all sites',
      'login.email_reg_title': '📮 Email sign-up',
      'login.email_reg_subtitle': 'Sign up for an account with an email verification code; your email becomes verified upon sign-up',
      'login.reg_title': '🎟️ Invite sign-up',
      'login.reg_subtitle': 'Sign up for an account with a one-time invite code',
      'login.set_password_title': '🔑 Set password',
      'login.set_password_subtitle': 'This account has no password yet; please set one to sign in',
      'login.forgot_title': '🔑 Forgot password',
      'login.forgot_subtitle': 'Reset your password through your bound and verified email',
      'login.msg_logging_in': 'Signing in…',
      'login.msg_login_ok': 'Signed in, redirecting…',
      'login.msg_registering': 'Signing up…',
      'login.msg_register_ok': 'Signed up, entering…',
      'login.msg_setting': 'Setting…',
      'login.msg_set_ok': 'Password set, entering…',
      'login.msg_resetting': 'Resetting…',
      'login.msg_reset_ok': 'Password reset, signing in…',
      'login.msg_send_ok': 'Sent, please check your inbox',
      'login.countdown': 'Resend in {s}s',
      'login.btn_resend_code': 'Resend code',

      // ---- account center: static ----
      'account.title': 'Account Center - 青翔未阔工作室',
      'account.description': 'Qxwk account pass · Account Center — view your unified account info and manage sign-in devices and authorized sites.',
      'account.loading': 'Loading account info…',
      'account.not_logged_title': 'You are not signed in',
      'account.not_logged_subtitle': 'Sign in to view your account pass information',
      'account.btn_go_login': 'Sign in / Sign up',
      'account.page_title': 'Account Center',
      'account.profile_edit_title': '✏️ Edit profile',
      'account.label_nickname': 'Nickname',
      'account.ph_nickname': '1-20 characters',
      'account.hint_nickname': 'Your nickname is shown across all sites; changes sync to every integrated site',
      'account.label_color': 'Custom color',
      'account.hint_color': 'Click to open the palette and choose your custom color',
      'account.color_menu_title': 'Choose a custom color',
      'account.label_email': 'Email',
      'account.ph_email': 'Optional, e.g. you@example.com',
      'account.hint_email': 'Only QQ Mail (@qq.com) can provide an avatar',
      'account.btn_save': 'Save changes',
      'account.email_card_title': '📧 Email verification',
      'account.email_subtitle': 'Verify your email to unlock all features',
      'account.btn_send_verify': 'Send code to the email above',
      'account.ph_code': '6-digit code',
      'account.btn_verify': 'Verify and bind',
      'account.pwd_card_title': '🔒 Reset password',
      'account.label_new_password': 'New password',
      'account.ph_new_password': '4-50 characters',
      'account.label_confirm_new_password': 'Confirm new password',
      'account.ph_confirm_new_password': 'Enter the new password again',
      'account.btn_change_password': 'Change password',
      'account.invite_title': '🎫 Invite friends',
      'account.btn_copy': 'Copy',
      'account.btn_generate': 'Generate invite code',
      'account.session_title': '💻 Sign-in devices',
      'account.btn_revoke_others': 'Sign out all other devices',
      'account.client_title': '🌐 Authorized sites',
      'account.logout_title': 'Sign out',
      'account.logout_tip': 'After signing out you must sign in again on this site; other devices are unaffected',
      'account.btn_logout': 'Sign out',

      // ---- account center: dynamic ----
      'account.welcome': 'Welcome back, {name} 👋',
      'account.uid': 'UID: {uid}',
      'account.user_color': 'Custom color',
      'account.reg_time': 'Registered on {date}',
      'account.avatar_alt': "{name}'s avatar",
      'account.user_fallback': 'User',
      'account.color_placeholder': 'Click to choose a custom color',
      'account.email_verified': 'Verified',
      'account.email_unverified': 'Unverified',
      'account.msg_verifying': 'Verifying…',
      'account.msg_email_verified': 'Bound successfully, email verified ✔',
      'account.msg_saving': 'Saving…',
      'account.msg_profile_saved': 'Profile updated ✔',
      'account.invite_paused': 'Invite code generation is paused',
      'account.invite_paused_hint': 'The administrator has paused invite code generation; no invite code is available right now',
      'account.invite_need_verify': 'Email verification required',
      'account.invite_need_verify_hint': 'Bind and verify your email to generate an invite code; any unused invite code will still be shown',
      'account.invite_hint': 'Share with friends to sign up; each code can only be used once',
      'account.invite_none': 'No invite code available',
      'account.invite_none_hint': 'Click “Generate invite code” to create one',
      'account.invite_failed': 'Failed to get',
      'account.copied': 'Copied ✅',
      'account.copy_failed': 'Copy failed, please copy manually',
      'account.err_new_password_mismatch': 'The two new passwords do not match',
      'account.err_all_fields': 'Please fill in all fields',
      'account.msg_changing': 'Changing…',
      'account.msg_password_updated': 'Password updated ✔',
      'account.no_sessions': 'No directly signed-in devices',
      'account.session_meta': 'Last active {last} · Signed in {created}',
      'account.badge_current': 'This device',
      'account.btn_revoke': 'Sign out',
      'account.revoked_others': 'Signed out {n} other device(s) ✔',
      'account.no_other_sessions': 'No other signed-in devices',
      'account.msg_session_revoked': 'This device has been signed out ✔',
      'account.src_unregistered': 'Unregistered source · ',
      'account.client_meta': '{src}{count} sign-in(s) · Last active {last}',
      'account.no_clients': 'No sign-ins from other sites or apps',
      'account.btn_revoke_client': 'Sign out',
      'account.revoked_clients': 'Signed out {n} sign-in(s) ✔',
      'account.countdown': 'Retry in {s}s',
      'account.btn_send_code': 'Send code',

      // ---- root router page ----
      'index.title': 'Qxwk 通行证',
      'index.description': 'Qxwk account pass — the unified account center of 青翔未阔工作室.',
      'index.checking': 'Checking sign-in status…',

      // ---- backend error codes ----
      'err.code_too_frequent': 'Too many requests, please try again later',
      'err.code_ip_daily_limit': 'Too many codes sent from your network today, please try again tomorrow',
      'err.code_email_daily_limit': 'Too many codes sent to this email today, please try again tomorrow',
      'err.code_too_many_attempts': 'Too many incorrect attempts, please request a new code',
      'err.invalid_code': 'Incorrect or expired verification code',
      'err.invalid_nickname': 'Nickname must be 1-20 characters',
      'err.invalid_password': 'Password must be 4-50 characters',
      'err.register_paused': 'Registration is paused and not accepting new sign-ups',
      'err.nickname_taken': 'This nickname is already taken, please choose another',
      'err.invite_code_required': 'Please enter an invite code',
      'err.invalid_invite_code': 'Invalid or already-used invite code',
      'err.invalid_email': 'Please enter a valid email address',
      'err.code_required': 'Please enter the verification code',
      'err.temp_email_not_allowed': 'Temporary email addresses are not allowed, please use a regular email',
      'err.email_taken': 'This email is already registered, please sign in or reset your password',
      'err.unauthorized': 'Not signed in',
      'err.invite_generate_failed': 'Failed to generate an invite code, please try again',
      'err.account_required': 'Please enter your nickname or email',
      'err.login_locked': 'Too many failed sign-in attempts, please try again in {minutes} minutes',
      'err.invalid_credentials': 'Incorrect account or password',
      'err.password_required': 'Please enter your password',
      'err.user_not_found': 'User not found',
      'err.invalid_color': 'Invalid color, please choose from the preset palette',
      'err.email_service_unavailable': 'Email service is not configured, please contact the administrator',
      'err.email_not_verified': 'This email is not verified',
      'err.email_send_failed': 'Failed to send the email, please try again later',
      'err.invalid_new_password': 'New password must be 4-50 characters',
      'err.password_mismatch': 'The two passwords do not match',
      'err.email_already_bound': 'This email is already bound to another account',
      'err.new_password_required': 'Please enter a new password',
      'err.invalid_params': 'Invalid parameters',
      'err.session_not_found': 'Device not found or is the current device',
      'err.client_not_found': 'No active sign-in from this source',
      'err.not_found': 'Endpoint not found',
      'err.request_failed': 'Request failed ({status})'
    }
  };

  var listeners = [];

  // ============================ 语言判定 ============================
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return (v === 'zh' || v === 'en') ? v : null;
    } catch (e) { return null; }
  }
  // 默认：localStorage 优先；否则中文浏览器 → zh，其余一律 en
  function detect() {
    var s = stored();
    if (s) return s;
    var nav = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
    return nav.indexOf('zh') === 0 ? 'zh' : 'en';
  }

  var current = detect();

  // ============================ 插值 / 取词 ============================
  function interpolate(str, params) {
    if (!params) return str;
    return String(str).replace(/\{(\w+)\}/g, function (m, k) {
      return (params[k] === undefined || params[k] === null) ? m : String(params[k]);
    });
  }
  // 找不到 key：有 fallback 用 fallback，没有则回退 key 本身（语言包缺条目不白屏）
  function t(key, params, fallback) {
    var pack = PACKS[current] || PACKS.en;
    var val = pack[key];
    if (val === undefined) {
      if (fallback !== undefined && fallback !== null) return interpolate(fallback, params);
      return key;
    }
    return interpolate(val, params);
  }

  // ============================ 应用标注 ============================
  var SETTERS = [
    ['data-i18n', function (el, v) { el.textContent = v; }],
    ['data-i18n-placeholder', function (el, v) { el.setAttribute('placeholder', v); }],
    ['data-i18n-title', function (el, v) { el.setAttribute('title', v); }],
    ['data-i18n-aria-label', function (el, v) { el.setAttribute('aria-label', v); }],
    ['data-i18n-content', function (el, v) { el.setAttribute('content', v); }]
  ];

  function applyI18n(target) {
    target = target || document;
    for (var i = 0; i < SETTERS.length; i++) {
      var attr = SETTERS[i][0];
      var set = SETTERS[i][1];
      var els = target.querySelectorAll('[' + attr + ']');
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        set(el, t(el.getAttribute(attr)));
      }
    }
    // <html lang>：zh → zh-CN，en → en
    root.lang = current === 'zh' ? 'zh-CN' : 'en';
    updateToggleLabel();
  }

  // ============================ 切换按钮 ============================
  // 中文界面显示「EN」（点它切到英文），英文界面显示「中」（点它切回中文）——即显示「切过去的那个语言」
  function updateToggleLabel() {
    var btn = document.getElementById('langToggle');
    if (btn) btn.textContent = current === 'zh' ? 'EN' : '中';
  }
  function toggle() {
    setLang(current === 'zh' ? 'en' : 'zh');
  }
  function bindToggle() {
    var tryCount = 40; // 限次 2 秒：页面没有该按钮时不留永不停止的定时器
    (function poll() {
      var btn = document.getElementById('langToggle');
      if (btn) {
        updateToggleLabel();
        btn.addEventListener('click', toggle);
        return;
      }
      if (--tryCount > 0) setTimeout(poll, 50);
    })();
  }

  // ============================ 对外 API ============================
  function getLang() { return current; }
  function setLang(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    current = lang;
    try { localStorage.setItem(KEY, lang); } catch (e) {}
    applyI18n();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (e) {}
    }
  }
  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  window.t = t;
  window.applyI18n = applyI18n;
  window.getLang = getLang;
  window.setLang = setLang;
  window.onChange = onChange;

  // ============================ 首屏防闪（只对非中文访客）============================
  // 中文访客的 HTML 原文即中文，不需要隐藏；非中文访客先隐藏 body，applyI18n() 后再显示。
  // JS 被禁用 → 本脚本不执行 → 不隐藏 → 正常显示中文，绝不长时间白屏。
  var pendingTimer = null;
  if (current !== 'zh') {
    root.setAttribute('data-i18n-pending', '');
    pendingTimer = setTimeout(function () { root.removeAttribute('data-i18n-pending'); }, 1000);
  }
  document.addEventListener('DOMContentLoaded', function () {
    try {
      applyI18n();
    } finally {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      root.removeAttribute('data-i18n-pending');
    }
  });

  // 跨标签同步
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    var v = stored();
    if (!v || v === current) return;
    current = v;
    applyI18n();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](current); } catch (err) {}
    }
  });

  bindToggle();
})();