// Qxwk-Account 通行证 · 系统设置

export async function getSetting(DB, key, fallback = '') {
  const row = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : fallback;
}
