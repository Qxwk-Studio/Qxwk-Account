-- Qxwk-Account 通行证服务 · 0002：重建 apps 表，把「检测名称」与「展示名称」拆开
--
-- 背景：旧表只有 name / origin / homepage。浏览器来源上报的是 Origin（是 URL），App 来源上报的是
-- 应用名（不是 URL），两类来源共用一张表却要按不同字段匹配：能解析成 URL 就查 origin，否则查 name。
-- 于是 App 只能往 origin 里塞 'app:cityfootprint-android' 这类占位串——它在 UNIQUE NOT NULL 列上，
-- 却永远不参与匹配，看着就是脏数据，也说不清「这列到底该填什么」。
-- 新表把「拿什么匹配」（match_type + match_key）与「给人看什么」（display_name）分成两件事：
--   match_type = 'origin' → 调用方是浏览器，match_key 存规范 origin（含端口 / 无路径），要与 Origin 头完全一致
--   match_type = 'name'   → 调用方是 App / 服务端直连，match_key 存它上报的原样字符串（**区分大小写**）
--
-- ⚠️ 本文件必须与 src/lib.js、src/worker.js 里 apps 相关 SQL 的改动**同一次上线**：
--    代码里已不再有 apps.name / apps.origin，只查 display_name / match_type / match_key。
--    先跑 SQL 后发代码（或反过来）都会让「已授权网站」卡认不出来源。
--
-- 线上旧库（不是用 migrations apply 建的）请手工执行本文件：
--   npx wrangler d1 execute qxwk-account --remote --file migrations/0002_apps_restructure.sql
-- 执行前先看一眼现有登记行，确认下面的迁移结果符合预期：
--   npx wrangler d1 execute qxwk-account --remote --command "SELECT id, name, origin, homepage FROM apps"
-- 迁移只跑一次：重复执行会在 INSERT ... SELECT 那步因 name/origin 列已不存在而报错（属预期）。
-- 若上一次真被打断、留下了 apps_new，开头的 DROP TABLE IF EXISTS 会清掉它重来（此时 apps 还是旧表，数据未丢）。

-- D1 默认**强制**外键（等价于 SQLite 的 PRAGMA foreign_keys = on），且不允许关掉它；
-- 而本文件要 DROP 被 sessions.client_id / login_log.client_id 引用的 apps。SQLite 的 DROP TABLE
-- 会先隐式 DELETE 全表，那一刻子表里指向它的行就是违规的 —— 必须把校验推迟到事务结束（那时
-- 新 apps 已经建好、id 一个没变，约束重新成立）。这是 D1 官方给的表重建写法：
-- https://developers.cloudflare.com/d1/sql-api/foreign-keys/
-- 另：sessions / login_log 的外键都没有 ON DELETE CASCADE，所以只是推迟校验、不存在被级联清空数据的风险。
PRAGMA defer_foreign_keys = on;

-- 1) 建新表（临时名，搬完数据再改名，避免中途没有 apps 表）
DROP TABLE IF EXISTS apps_new;
CREATE TABLE apps_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,               -- 展示名称：账号中心「已授权网站」卡里给人看的名字，如 "City Footprint"
  match_type   TEXT NOT NULL DEFAULT 'origin'
               CHECK (match_type IN ('origin', 'name')),
                                            -- 检测方式：见文件头注释
  match_key    TEXT NOT NULL UNIQUE,        -- 检测名称：真正用来判定来源归属的串
  homepage     TEXT,                        -- 主页（展示用，可空）
  created_at   TEXT DEFAULT (datetime('now'))
);

-- 2) 搬旧数据。id 必须原样沿用 —— sessions.client_id / login_log.client_id 存的就是 apps.id，
--    换 id 会让所有历史会话与登录记录查不到站点名，全变成「已移除的站点」。
--    旧 origin 是 http(s) URL 的按 origin 匹配；不是的（占位串）判定为 App 类，
--    检测名称改用 name —— 那才是调用方真正上报、也是 resolveClient 实际拿来匹配的串。
INSERT INTO apps_new (id, display_name, match_type, match_key, homepage, created_at)
SELECT id,
       name,
       CASE WHEN origin LIKE 'http://%' OR origin LIKE 'https://%' THEN 'origin' ELSE 'name' END,
       CASE WHEN origin LIKE 'http://%' OR origin LIKE 'https://%' THEN origin ELSE name END,
       homepage,
       created_at
FROM apps;

-- 3) 换名。sessions / login_log 里 `REFERENCES apps(id)` 的声明不受影响：它们引用的是表名 apps，
--    而重命名的只是 apps_new，id 也一个没变，事务结束时外键重新成立
DROP TABLE apps;
ALTER TABLE apps_new RENAME TO apps;

-- 恢复即时校验（不写这句也会在事务结束时隐式恢复，写上是为了表明「到这里约束必须已经成立」）
PRAGMA defer_foreign_keys = off;