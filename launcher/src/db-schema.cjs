'use strict';
//By leewheel 2026年11月9日 数据表清单核对（老大要求）
// 问题：更新包把 SQL 导进库以后，到底有没有“表建全、字段齐全”，以前没人核。
//      SQL 报错会被抓，但“SQL 成功、表却没建出来”（库不存在、脚本跳过了、导到了别的库）只能靠人肉翻日志。
// 做法：
//   ① 打包时把 3395 每个库的【表名 + 字段名】导出成清单，放进包的 dbcheck/ 目录（gen_dbcheck.cjs 生成）；
//   ② 更新完在目标机按清单核一遍：缺表、缺字段逐条列出来，报告写到 <根>\.coa-launcher\dbcheck\，
//      界面只显示一句摘要 + 前几条，具体原因写文件，方便老大直接拿去对账。
// 判定（重要，不能把玩家卡死）：
//   缺的表如果**本包的 SQL 里就有 CREATE TABLE**，说明脚本没生效 → 硬失败，更新中止；
//   缺的表只是清单里有、本包并不负责创建 → 只记警告 + 明细（发布库本来就比开发库旧）；
//   bak_* 这类备份快照表在清单里标 optional，一律不算问题。
const fsp = require('node:fs/promises');
const path = require('node:path');

// 包根下允许放清单的目录名（大小写不敏感，取第一个能找到的）
const MANIFEST_DIRS = ['dbcheck', 'db-check', 'db-schema', 'schema'];
// 库名只允许这种形态，防止清单被人塞进 SQL 片段
const DATABASE = /^[A-Za-z0-9_]{1,64}$/;
// 明确“不算错”的表名前缀：中文化备份快照、临时表
const OPTIONAL_TABLE = /^(bak_|backup_|zz_|tmp_)/i;

// 在包内容根目录里找清单 JSON（recursive 不需要：清单永远平铺在 dbcheck/ 下）
async function readManifest(folder) {
  for (const name of MANIFEST_DIRS) {
    const dirs = [name, name.toUpperCase()];
    for (const dirName of dirs) {
      const dir = path.join(folder, dirName);
      const stat = await fsp.stat(dir).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const files = (await fsp.readdir(dir).catch(() => []))
        .filter(file => /\.json$/i.test(file))
        .sort();
      for (const file of files) {
        const full = path.join(dir, file);
        const text = await fsp.readFile(full, 'utf8').catch(() => '');
        if (!text) continue;
        let data = null;
        try { data = JSON.parse(text); } catch { continue; }
        if (!data || typeof data !== 'object' || !data.databases || typeof data.databases !== 'object') continue;
        return { dir, file: full, name: file, data };
      }
    }
  }
  return null;
}

// 本包 SQL 里声明要建的表：按 server\SQL\<库名>\*.sql 统计，用来区分“该建没建”和“本来就不归本包管”
// 返回 Map<库名, Set<表名>>，另外用 "<库名>#columns" 存 Map<表名, Set<字段名>>（ALTER TABLE ... ADD COLUMN）
async function createdTables(sqlRoot) {
  const out = new Map();
  if (!sqlRoot) return out;
  const entries = await fsp.readdir(sqlRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !DATABASE.test(entry.name)) continue;
    const tables = new Set();
    const columns = new Map();
    const dir = path.join(sqlRoot, entry.name);
    const files = (await fsp.readdir(dir).catch(() => [])).filter(file => /\.sql$/i.test(file));
    for (const file of files) {
      const full = path.join(dir, file);
      // 单个 SQL 脚本正常都在几 MB 以内，超大的（几百 MB 的备份）不读，避免把内存吃满
      const stat = await fsp.stat(full).catch(() => null);
      if (!stat || stat.size > 64 * 1024 * 1024) continue;
      const text = await fsp.readFile(full, 'utf8').catch(() => '');
      if (!text) continue;
      // CREATE TABLE [IF NOT EXISTS] `name` / ALTER TABLE `name` ADD [COLUMN] `col`
      for (const match of text.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi)) tables.add(match[1].toLowerCase());
      for (const match of text.matchAll(/ALTER\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s+ADD\s+(?:COLUMN\s+)?`?([A-Za-z0-9_]+)`?/gi)) {
        const table = match[1].toLowerCase();
        const set = columns.get(table) || new Set();
        set.add(match[2].toLowerCase());
        columns.set(table, set);
      }
    }
    out.set(entry.name, tables);
    out.set(`${entry.name}#columns`, columns);
  }
  return out;
}

// information_schema 查询结果按“一行一条”返回（--skip-column-names + --batch，多列用 Tab 分隔）
function rows(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function actualSchema(query, database) {
  const tables = new Map();
  const tableRows = rows(await query(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${database}'`, database));
  if (!tableRows.length) return null;
  for (const name of tableRows) tables.set(name, new Set());
  const columnRows = rows(await query(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}'`, database));
  for (const line of columnRows) {
    const [table, column] = line.split('\t');
    if (!table || !column) continue;
    if (!tables.has(table)) tables.set(table, new Set());
    tables.get(table).add(column);
  }
  return tables;
}

// query(sql) 由调用方注入（release-update 的 mysqlQuery 已经会走 worldserver.conf 的连接串），
// 这样这个文件不依赖 release-update，避免循环 require。
async function checkSchema({ query, manifest, sqlRoot, onLine = () => {} }) {
  const result = { databases: 0, tables: 0, columns: 0, problems: [], warnings: [], details: [], missingTables: 0, missingColumns: 0 };
  if (!manifest?.data?.databases) return { ...result, skipped: '清单为空' };
  const created = await createdTables(sqlRoot);
  const databases = Object.entries(manifest.data.databases).sort(([a], [b]) => a.localeCompare(b));
  for (const [database, spec] of databases) {
    if (!DATABASE.test(database)) {
      result.warnings.push(`清单里的库名不合法，已跳过：${database}`);
      continue;
    }
    const tables = (spec && typeof spec === 'object' && spec.tables && typeof spec.tables === 'object') ? spec.tables : {};
    const names = Object.keys(tables).sort();
    if (!names.length) continue;
    result.databases++;
    let actual = null;
    try { actual = await actualSchema(query, database); }
    catch (error) {
      result.warnings.push(`读不到 ${database} 的表结构：${String(error.message || error).split(/\r?\n/).pop()}`);
      continue;
    }
    const createdTablesForDb = created.get(database) || new Set();
    const createdColumnsForDb = created.get(`${database}#columns`) || new Map();
    if (!actual) {
      // 整个库都不存在：本包给它建过表才算硬失败，否则只是提示
      const hard = names.some(name => createdTablesForDb.has(name.toLowerCase()));
      const line = `库 ${database} 不存在（清单里有 ${names.length} 张表）`;
      if (hard) result.problems.push(`${line}，而本包 SQL 就是往这个库建表的`);
      else result.warnings.push(line);
      result.details.push({ database, kind: 'database', problem: true, message: line });
      result.missingTables += names.length;
      continue;
    }
    for (const name of names) {
      const spec2 = tables[name] && typeof tables[name] === 'object' ? tables[name] : {};
      const optional = spec2.optional === true || OPTIONAL_TABLE.test(name);
      const columns = Array.isArray(spec2.columns) ? spec2.columns : [];
      result.tables++;
      const live = actual.get(name);
      if (!live) {
        // 备份快照表（bak_*/backup_*）缺了不算错，也不占摘要里“缺表”的名额
        if (optional) continue;
        result.missingTables++;
        const byPackage = createdTablesForDb.has(name.toLowerCase());
        const message = `${database}.${name}：表不存在${byPackage ? '（本包 SQL 里就有 CREATE TABLE，说明脚本没生效）' : ''}`;
        if (byPackage) result.problems.push(message);
        else result.warnings.push(message);
        result.details.push({ database, table: name, kind: 'table', problem: byPackage, message });
        continue;
      }
      for (const column of columns) {
        result.columns++;
        if (live.has(column)) continue;
        if (optional) continue;
        result.missingColumns++;
        const byPackage = (createdColumnsForDb.get(name.toLowerCase()) || new Set()).has(String(column).toLowerCase());
        const message = `${database}.${name}.${column}：字段不存在${byPackage ? '（本包 SQL 里有 ALTER TABLE ... ADD）' : ''}`;
        if (byPackage) result.problems.push(message);
        else result.warnings.push(message);
        result.details.push({ database, table: name, column, kind: 'column', problem: byPackage, message });
      }
    }
  }
  onLine(`数据表核对：${result.databases} 个库 / ${result.tables} 张表 / ${result.columns} 个字段，缺表 ${result.missingTables}、缺字段 ${result.missingColumns}`);
  return result;
}

// 报告：给老大直接看的对账文件（写进 <根>\.coa-launcher\dbcheck\）
function renderReport({ manifest, result, at }) {
  const lines = [];
  lines.push('# 数据表核对报告');
  lines.push('');
  lines.push(`生成时间：${at}`);
  lines.push(`清单文件：${manifest?.name || '(无)'}`);
  lines.push(`清单来源：${manifest?.data?.source || '(未标注)'}`);
  lines.push('');
  lines.push(`核对范围：${result.databases} 个库 / ${result.tables} 张表 / ${result.columns} 个字段`);
  lines.push(`结果：缺表 ${result.missingTables} 张，缺字段 ${result.missingColumns} 个`);
  lines.push('');
  if (result.problems.length) {
    lines.push(`## 必须修的（${result.problems.length}）`);
    lines.push('');
    for (const item of result.problems) lines.push(`- ${item}`);
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push(`## 只做提示的（${result.warnings.length}）`);
    lines.push('');
    for (const item of result.warnings.slice(0, 500)) lines.push(`- ${item}`);
    if (result.warnings.length > 500) lines.push(`- …还有 ${result.warnings.length - 500} 条，见同名 .json`);
    lines.push('');
  }
  if (!result.problems.length && !result.warnings.length) {
    lines.push('## 结论');
    lines.push('');
    lines.push('清单里的表与字段全部齐全，没有任何缺失。');
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { readManifest, checkSchema, createdTables, renderReport, MANIFEST_DIRS, OPTIONAL_TABLE };
