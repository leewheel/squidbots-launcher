'use strict';
//By leewheel 2026年11月6日 建表兜底（schema guard）：
// 按老大要求把核心的数据库自动更新关掉了（Updates.EnableDatabases = 0），
// 但新版本核心用到的新表如果库里没有，世界服在 mysql_stmt_prepare 阶段就会报
// “Table ... doesn't exist” 然后直接退出（实测：account_bazaar_token_hourly_cap、ascension_race_class_stats）。
// 所以启动器自带三份只含 CREATE TABLE IF NOT EXISTS 的脚本（assets/schema-{world,characters,auth}.sql，
// 由核心 pending_db_* 抽取生成），每次启动服务端前跑一遍：表已存在就是空操作。
const fs = require('node:fs');
const path = require('node:path');
const releaseUpdate = require('./release-update.cjs');

const PACKS = [
  { key: 'world', file: 'schema-world.sql', database: 'acore_world' },
  { key: 'characters', file: 'schema-characters.sql', database: 'acore_characters' },
  { key: 'auth', file: 'schema-auth.sql', database: 'acore_auth' },
];

/**
 * 确保世界库/角色库/登录库需要的表都存在。
 * @param {string} serverRoot 服务端目录（含 configs/ mysql/）
 * @returns {Promise<{ran: string[], skipped: string[]}>}
 */
async function ensureDatabaseSchema(serverRoot) {
  const ran = [];
  const skipped = [];
  if (!serverRoot) return { ran, skipped: ['没有服务端目录'] };
  const conns = releaseUpdate.readDbConfig(serverRoot);
  if (!conns || !Object.keys(conns).length) return { ran, skipped: ['读不到数据库连接信息'] };
  for (const pack of PACKS) {
    const file = path.join(__dirname, '..', 'assets', pack.file);
    if (!fs.existsSync(file)) { skipped.push(`${pack.file} 不存在`); continue; }
    const conn = conns[pack.key];
    if (!conn) { skipped.push(`${pack.key} 没有连接信息`); continue; }
    try {
      const ready = await releaseUpdate.waitForMysql(serverRoot, { conn, timeoutMs: 60000 });
      if (!ready) { skipped.push(`${pack.database} 没就绪`); continue; }
      await releaseUpdate.importSqlFile(serverRoot, file, conn.db || pack.database, conn);
      ran.push(pack.database);
    } catch (error) {
      skipped.push(`${pack.database}：${String(error?.message || error).slice(0, 120)}`);
    }
  }
  return { ran, skipped };
}

module.exports = { ensureDatabaseSchema };
