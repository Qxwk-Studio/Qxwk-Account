// Qxwk-Account 通行证 · 邮箱验证码
//
// 五种用途共用一张 email_verification_codes：register / login / reset_password /
// verify_email / change_email。码本身只存 SHA-256(email:purpose:code)，5 分钟过期。
// 发信走 Resend，密钥只从环境变量 EMAIL_API_KEY 读取。

import { sha256Hex, randomInt } from './crypto.js';

export const EMAIL_CODE_TTL = 300;      // 秒
export const EMAIL_CODE_MAX_TRY = 5;

// 常见一次性/临时邮箱根域。按「等于该域或以它为后缀」匹配，所以只写根域。
// 名单只求覆盖常见服务，不追求穷尽（自己注册域名即可绕过，这一点防不住）。
export const TEMP_EMAIL_DOMAINS = [
  'mailinator.com', '10minutemail.com', '10minutemail.net', 'guerrillamail.com', 'guerrillamail.net',
  'guerrillamail.org', 'guerrillamail.de', 'sharklasers.com', 'grr.la', 'spam4.me',
  'temp-mail.org', 'temp-mail.io', 'tempmail.com', 'tempmail.net', 'tempmail.dev', 'tempmailaddress.com',
  'throwawaymail.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'maildrop.cc',
  'trashmail.com', 'trashmail.net', 'getnada.com', 'nada.email', 'dispostable.com',
  'fakeinbox.com', 'mailnesia.com', 'mintemail.com', 'mytemp.email', 'mohmal.com',
  'moakt.com', 'tempr.email', 'discard.email', 'discardmail.com', 'mailcatch.com',
  'spambog.com', 'spamgourmet.com', 'mailforspam.com', 'throwam.com', 'emailondeck.com',
  'burnermail.io', 'inboxkitten.com', '33mail.com', 'instantemailaddress.com',
  'guerrillamail.info', 'guerrillamail.biz', 'guerrillamailblock.com', 'pokemail.net', 'spam.la',
  '10minemail.com', '10minutemail.org', '10minutemail.de', '10minutemail.co.za', '10minutetempemail.com',
  'fexpost.com', 'fexbox.org', 'tempemail.cc', 'tempmail.cc', 'tempemail.net', 'tempemailaddress.com',
  'mail.tm', 'mail.gw',
  'dropmail.me', '10mail.org', 'emlhub.com', 'emlpro.com', 'emltmp.com',
  '1secmail.com', '1secmail.net', '1secmail.org', '1secmail.xyz', '1secmail.ru', 'wwjmp.com',
  'xojxe.com', 'yoggm.com', 'mailinator2.com', 'sogetthis.com',
  'emailfake.com', 'generator.email', 'email-temp.com', 'tempmailo.com', 'tempmail.email', 'tempmail.lol',
  'tmailor.com', 'mail7.io', 'tempsky.com', 'tempinbox.com', '20minutemail.com',
  'mailsac.com', 'inboxes.com', 'emailnator.com', 'luxusmail.org', 'disposablemail.com', 'mailnull.com',
  'getairmail.com', 'airmail.cc', 'harakirimail.com', 'inboxbear.com', 'boun.cr',
  'trashmail.at', 'trashmail.me', 'trashmail.io', 'trashmail.ws', 'trashmail.org', 'trashmail.de',
  'trash-mail.com', 'trash-mail.at', 'trash-mail.net', 'mytrashmail.com', 'mytrashmailer.com', 'mailmetrash.com',
  'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org', 'wegwerfemail.de',
  'jetable.org', 'jetable.com', 'jetable.net', 'mail-temporaire.fr',
  'spamavert.com', 'spambox.us', 'spamfree24.org', 'spamhereplease.com', 'throwaway.email',
  'iwatermail.com',
  'linshiyouxiang.net', 'linshi-mail.com', 'snapmail.cc', 'tempmail.plus', 'mailto.plus',
  '24mail.chacuo.net', 'chacuo.net', 'mail.cx', '1mail.name', 'smailpro.com', 'xinshi.pw',
  'ruutukf.com', 'globalsmv.com', 'agenticengineer.pro', 'asdk04.icu', 'filorosso.shop',
  'hnyjktv.com', 'jqrvlhc.com', 'kwkub.cyou', 'lunvira.pro', 'ofaldgw.com',
  'onlylicensedcasinos.com', 'paytrust.cc', 'prgtc.vip', 'talmirexo.org', 'xenveroes.pro',
  'xiakdi.com', 'zkqjdkd.com',
];

export function isTempEmail(email) {
  const s = String(email || '').toLowerCase();
  const at = s.lastIndexOf('@');
  if (at < 0) return false;
  const domain = s.slice(at + 1);
  return TEMP_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function genEmailCode() {
  return String(randomInt(1000000)).padStart(6, '0');
}

export function emailCodeHash(email, purpose, code) {
  return sha256Hex(`${email}:${purpose}:${code}`);
}

const PURPOSE_TEXT = {
  register: { subject: '注册验证码', intro: '你正在注册 Qxwk 通行证，请输入下方验证码完成注册：' },
  login: { subject: '登录验证码', intro: '你正在登录 Qxwk 通行证，请输入下方验证码：' },
  reset_password: { subject: '重置密码', intro: '我们收到了你的密码重置申请，请输入下方验证码并设置新密码：' },
  verify_email: { subject: '验证邮箱', intro: '请使用下方验证码完成 Qxwk 通行证邮箱验证：' },
  change_email: { subject: '更换邮箱', intro: '请使用下方验证码确认更换为这个邮箱：' },
};

export function renderBrandEmail({ title, intro, code }) {
  return `<div style="background:#f1f5f9;margin:0;padding:32px 16px;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" style="max-width:420px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="background:#2563eb;padding:6px 0;"></td></tr>
      <tr><td style="padding:28px 32px 0;text-align:center;">
        <div style="font-size:17px;font-weight:700;">青翔未阔工作室</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px;">Qxwk 通行证 · ${title}</div>
      </td></tr>
      <tr><td style="padding:20px 32px 0;font-size:14px;line-height:1.7;color:#334155;">${intro}</td></tr>
      <tr><td style="padding:18px 32px 0;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px;text-align:center;">
          <div style="font-size:11px;color:#64748b;letter-spacing:1px;">验证码</div>
          <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#2563eb;margin-top:4px;">${code}</div>
        </div>
      </td></tr>
      <tr><td style="padding:16px 32px 0;font-size:12px;color:#64748b;text-align:center;">验证码 <b>5 分钟</b> 内有效，过期需重新获取。</td></tr>
      <tr><td style="padding:16px 32px 0;">
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:12px;color:#92400e;line-height:1.6;">若非本人操作，请忽略本邮件并不要告知他人验证码。</div>
      </td></tr>
      <tr><td style="padding:20px 32px 24px;font-size:11px;color:#94a3b8;text-align:center;">此邮件由系统自动发送，请勿直接回复。</td></tr>
    </table>
  </td></tr></table>
</div>`;
}

export function isEmailConfigured(env) {
  return !!env.EMAIL_API_KEY;
}

export async function sendEmail(env, to, subject, htmlBody) {
  const key = env.EMAIL_API_KEY;
  if (!key) throw new Error('未配置 EMAIL_API_KEY');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Qxwk 通行证 <verify@account.qxwkstudio.top>',
      to,
      subject,
      html: htmlBody,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`邮件发送失败 ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function sendCodeEmail(env, to, purpose, code) {
  const meta = PURPOSE_TEXT[purpose] || PURPOSE_TEXT.verify_email;
  return sendEmail(env, to, `Qxwk 通行证 · ${meta.subject}`, renderBrandEmail({
    title: meta.subject,
    intro: meta.intro,
    code,
  }));
}
