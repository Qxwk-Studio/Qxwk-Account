-- Qxwk-Account 通行证服务 · 多会话登录（登录设备管理）
-- sessions 由「单会话/用户，重新登录轮换」改为「多会话」：同一账号可在多台设备同时登录，可逐个或一次性下线
-- 注意：0001_init.sql 已线上应用，不能改动（会造成迁移校验和不一致），新增列一律走本文件

-- 登录时的浏览器 UA 原始串（历史会话为 NULL；设备名由后端 describeDevice 统一解析，前端只消费结果字符串）
ALTER TABLE sessions ADD COLUMN user_agent TEXT;

-- 最后活跃时间（鉴权请求时节流滚动更新：与上次相差 >1 小时才写库，避免每个请求都产生写入）
-- 历史会话为 NULL，查询时用 COALESCE(last_seen_at, created_at) 回退，无需数据回填
ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;