'use strict';
//By leewheel 2026年11月19日 「新机器人」带清拍卖的 SQL 检查（移植上游 3c3a191 的测试思路）：
// 这一条最容易伤到真实数据，所以只钉三件事——① 动的库对不对；② 只清机器人/失效卖家/（可选）拍卖行机器人的；
// ③ 给玩家退款的邮件字段与核心一致。真正跑库的部分在发布前手工在副本上验证。
const test = require('node:test');
const assert = require('node:assert');
const { auctionPurgeSql } = require('../src/realms.cjs');

test('次级国度用带后缀的库与它自己的账号前缀', () => {
  const text = auctionPurgeSql('living');
  assert.match(text, /acore_characters_living\.auctionhouse/);
  assert.match(text, /acore_characters_living\.item_instance/);
  assert.match(text, /acore_characters_living\.mail/);
  assert.match(text, /oa\.username LIKE 'RNDLV%'/);
});

test('主服（coa）用 acore_characters 与 RNDBOT 前缀', () => {
  const text = auctionPurgeSql('coa');
  assert.match(text, /FROM acore_characters\.auctionhouse/);
  assert.match(text, /oa\.username LIKE 'RNDBOT%'/);
});

test('默认连拍卖行机器人（AHBOT）的拍卖一起清；不勾选时保留', () => {
  assert.match(auctionPurgeSql('living', { house: true }), /oa\.username = 'AHBOT'/);
  assert.ok(!/oa\.username = 'AHBOT'/.test(auctionPurgeSql('living', { house: false })), '取消勾选就不能带上 AHBOT');
});

test('玩家的拍卖不会被选中：只按机器人前缀/失效卖家/（可选）AHBOT 判定', () => {
  const text = auctionPurgeSql('living');
  // 卖家判定里必须只有这三类条件，不能出现“清所有拍卖”的写法
  const where = /WHERE (o\.guid IS NULL OR oa\.id IS NULL OR oa\.username LIKE 'RNDLV%'[^`]*)/.exec(text);
  assert.ok(where, '找不到卖家判定');
  assert.ok(!/WHERE 1|WHERE TRUE|auctionhouse ah WHERE ah\./i.test(text), '不能整表清空');
});

test('退款只给真人买家，邮件按“拍卖取消”格式（站内信 62、subject 带 :4:）', () => {
  const text = auctionPurgeSql('living');
  assert.match(text, /ba\.username NOT LIKE 'RNDLV%' AND ba\.username <> 'AHBOT'/);
  assert.match(text, /INSERT INTO acore_characters_living\.mail[\s\S]*?2, 62, 0, houseid, buyguid/);
  assert.match(text, /':4:'/);
  assert.match(text, /money[\s\S]*?lastbid/);
});

test('非法国度标识直接拒绝（防拼接进 SQL）', () => {
  assert.throws(() => auctionPurgeSql('living; DROP DATABASE acore_world'), /不合法|Unknown realm/);
});

test('先选默认库（临时表不能用库名限定，否则 No database selected），整段是一个事务', () => {
  const text = auctionPurgeSql('living');
  // 这两点都是临时实例实测抓到的：没有 USE 时第 2 句就失败
  assert.match(text, /^USE acore_characters_living;/);
  assert.match(text, /START TRANSACTION;/);
  assert.match(text, /COMMIT;/);
});

test('最后回传三个数，且临时表只被打开一次（同句引用两次会 Can\'t reopen table）', () => {
  const text = auctionPurgeSql('living');
  const tail = text.split('COMMIT;')[1];
  assert.match(tail, /SELECT \(SELECT COUNT\(\*\) FROM purge_ah\) AS auctions, COUNT\(\*\) AS refunds, COALESCE\(SUM\(lastbid\), 0\) AS refunded FROM purge_refund/);
  assert.equal((tail.match(/purge_refund/g) || []).length, 1, '同一条语句里 purge_refund 只能出现一次');
});
