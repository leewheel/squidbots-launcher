'use strict';
//By leewheel 2026-11-03
// MPQ 归档的"追加式注入"（Node 原生实现，不依赖外部工具）
//
// 用途：把更新包里的 dbc 写进客户端已有的补丁档（默认 Client\Data\patch-Y.mpq）的 DBFilesClient\<名字>.dbc。
// 原理（与 PB 启动器的 MpqInjector 完全一致）：
//   1. 找到 MPQ 头（0x00/0x200/… 或 0x1B 用户数据头指向的真正头）；
//   2. 读出 hash 表 / block 表 / hi-block 表（hash、block 表是 Storm 加密的，用固定 key 解）；
//   3. 用文件名算出 hash 槽位，找到该文件在 block 表里的索引；归档里没有就直接拒绝（只替换、不新增）；
//   4. 新数据【追加】到文件末尾（单块、不压缩、不加密：flags = EXISTS|SINGLE_UNIT），旧数据原地保留（可回滚）；
//   5. 重建三张表放在新数据之后，改写 header 的 6 个字段（archiveSize / hash / block / hi-block 位置及高位）。
// 这样只动表的指针，不改任何已有数据；失败时把 header 写回 + 截断回原长度即可完全还原。
const fs = require('node:fs');

const FLAG_EXISTS = 0x80000000;
const FLAG_SINGLE_UNIT = 0x01000000;
const FLAG_COMPRESS = 0x00000200;

// ---------------------------------------------------------------- Storm 加密表与算法
const CRYPTO_TABLE = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let index1 = 0; index1 < 0x100; index1++) {
    let index2 = index1;
    for (let i = 0; i < 5; i++) {
      seed = (seed * 125 + 3) % 0x2AAAAB;
      const temp1 = (seed & 0xFFFF) << 0x10;
      seed = (seed * 125 + 3) % 0x2AAAAB;
      const temp2 = seed & 0xFFFF;
      table[index2] = (temp1 | temp2) >>> 0;
      index2 += 0x100;
    }
  }
  return table;
})();

const HASH_TABLE_OFFSET = 0;
const HASH_NAME_A = 1;
const HASH_NAME_B = 2;
const HASH_FILE_KEY = 3;

// 标准 Storm 字符串哈希（文件名统一转成小写、反斜杠分隔）
function hashString(name, type) {
  let seed1 = 0x7FED7FED;
  let seed2 = 0xEEEEEEEE;
  const text = String(name).replace(/\//g, '\\');
  for (let i = 0; i < text.length; i++) {
    const ch = text.toUpperCase().charCodeAt(i);
    seed1 = (CRYPTO_TABLE[(type * 0x100) + ch] ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
  }
  return seed1 >>> 0;
}

// Storm 数据（表）加密/解密：seed1 按 Storm 的位变换推进，seed2 累加；
// 加密时 seed2 用原值推进，解密时用解出的明文推进（两者互为逆运算）。
// 长度按 4 字节整数处理（不足 4 字节的尾巴保持原样，与 StormLib 一致）。
function crypt(data, key, mode) {
  const out = Buffer.from(data);
  let seed1 = key >>> 0;
  let seed2 = 0xEEEEEEEE;
  const words = Math.floor(out.length / 4);
  for (let i = 0; i < words; i++) {
    seed2 = (seed2 + CRYPTO_TABLE[0x400 + (seed1 & 0xFF)]) >>> 0;
    const value = out.readUInt32LE(i * 4);
    const result = (value ^ ((seed1 + seed2) >>> 0)) >>> 0;
    seed1 = ((((~seed1) << 21) + 0x11111111) | (seed1 >>> 11)) >>> 0;
    seed2 = (((mode === 'decrypt' ? result : value) + seed2 + (seed2 << 5) + 3) >>> 0);
    out.writeUInt32LE(result, i * 4);
  }
  return out;
}
const decrypt = (data, key) => crypt(data, key, 'decrypt');
const encrypt = (data, key) => crypt(data, key, 'encrypt');

// 表加密用的 key：Storm 用 MPQ_HASH_FILE_KEY(3) 算 "(hash table)" / "(block table)"
const HASH_TABLE_KEY = hashString('(hash table)', HASH_FILE_KEY);
const BLOCK_TABLE_KEY = hashString('(block table)', HASH_FILE_KEY);

// ---------------------------------------------------------------- 读归档
function findHeaderOffset(buffer) {
  const candidates = [0, 0x200, 0x400, 0x600, 0x800, 0xA00, 0xC00, 0xE00];
  for (const offset of candidates) {
    if (offset + 4 > buffer.length) continue;
    if (buffer[offset] === 0x4D && buffer[offset + 1] === 0x50 && buffer[offset + 2] === 0x51 && (buffer[offset + 3] === 0x1A || buffer[offset + 3] === 0x1B)) {
      if (buffer[offset + 3] === 0x1B) {
        // MPQ\x1B：16 字节用户数据头，第 8 字节起 4 字节指向真正头部
        if (offset + 16 > buffer.length) continue;
        return { user: offset, header: buffer.readUInt32LE(offset + 8) };
      }
      return { user: -1, header: offset };
    }
  }
  return null;
}

function isMpqFile(file) {
  try {
    const handle = fs.openSync(file, 'r');
    try {
      const head = Buffer.alloc(0x1000);
      const read = fs.readSync(handle, head, 0, head.length, 0);
      return !!findHeaderOffset(head.subarray(0, read));
    } finally { fs.closeSync(handle); }
  } catch { return false; }
}

// 打开归档：只读头部与三张表（按需定位读，不整读文件，客户端档动辄几 GB）
function openArchive(file, { writable = false } = {}) {
  const fd = fs.openSync(file, writable ? 'r+' : 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(0x1000, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const found = findHeaderOffset(head);
    if (!found) throw new Error('不是有效的 MPQ 归档：未找到 MPQ 签名');
    const at = found.header;
    const headerHead = Buffer.alloc(32);
    fs.readSync(fd, headerHead, 0, 32, at);
    const declaredSize = headerHead.readUInt32LE(4);
    // 头部只有 headerSize 字节（v1=0x20，v2=0x2C）；0x2C 之后是文件数据区，读多了绝不能写回
    const headerSize = Math.max(32, Math.min(declaredSize, 0x100));
    const headerRaw = Buffer.alloc(headerSize);
    fs.readSync(fd, headerRaw, 0, headerSize, at);
    const archiveSize = headerRaw.readUInt32LE(8);
    const formatVersion = headerRaw.readUInt16LE(12);
    const blockSizeShift = headerRaw.readUInt16LE(14);
    const hashPos = headerRaw.readUInt32LE(16);
    const blockPos = headerRaw.readUInt32LE(20);
    const hashEntries = headerRaw.readUInt32LE(24);
    const blockEntries = headerRaw.readUInt32LE(28);
    // v2 及以上才有 hi-block 表位置与位置高位（v3/v4 布局不同，这里按 v2 处理，够客户端补丁档用）
    const hasHigh = formatVersion >= 1 && headerSize >= 0x2C;
    const hiBlockPos = hasHigh ? Number(headerRaw.readBigUInt64LE(32)) : 0;
    const hashPosHi = hasHigh ? headerRaw.readUInt16LE(40) : 0;
    const blockPosHi = hasHigh ? headerRaw.readUInt16LE(42) : 0;

    const readAt = (offset, length) => {
      if (!length) return Buffer.alloc(0);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, offset);
      return buffer;
    };
    const hashStart = hashPos + hashPosHi * 0x100000000;
    const blockStart = blockPos + blockPosHi * 0x100000000;
    const hashTable = decrypt(readAt(hashStart, hashEntries * 16), HASH_TABLE_KEY);
    const blockTable = decrypt(readAt(blockStart, blockEntries * 16), BLOCK_TABLE_KEY);
    const hiBlockTable = hiBlockPos > 0 ? readAt(hiBlockPos, blockEntries * 2) : Buffer.alloc(blockEntries * 2);
    return {
      file, fd, size, headerOffset: at, headerSize, headerRaw, archiveSize, formatVersion, blockSizeShift,
      sectorSize: 512 << blockSizeShift,
      hashPos: hashStart, blockPos: blockStart, hashEntries, blockEntries, hiBlockPos, hasHigh,
      hashTable, blockTable, hiBlockTable, readAt,
    };
  } catch (error) {
    try { fs.closeSync(fd); } catch {}
    throw error;
  }
}

function closeArchive(archive) { try { fs.closeSync(archive.fd); } catch {} }

// 兼容旧调用（一次性读完再用，测试用）：返回同样结构，但数据在内存里
function readArchive(file) {
  const archive = openArchive(file);
  archive.buffer = archive.readAt(0, archive.size);
  return archive;
}

// 找文件的 hash 槽位：命中返回 slot 与 block 索引；没有该文件返回 -1
function findSlot(archive, arcName) {
  const count = archive.hashEntries;
  if (!count) return { slot: -1, blockIndex: -1 };
  const nameA = hashString(arcName, HASH_NAME_A);
  const nameB = hashString(arcName, HASH_NAME_B);
  const table = hashString(arcName, HASH_TABLE_OFFSET);
  let slot = table & (count - 1);
  for (let i = 0; i < count; i++) {
    const at = slot * 16;
    const entryNameA = archive.hashTable.readUInt32LE(at);
    const entryNameB = archive.hashTable.readUInt32LE(at + 4);
    const entryBlock = archive.hashTable.readUInt32LE(at + 12);
    if (entryBlock === 0xFFFFFFFF) return { slot: -1, blockIndex: -1 };
    if (entryNameA === nameA && entryNameB === nameB) return { slot, blockIndex: entryBlock };
    slot = (slot + 1) & (count - 1);
  }
  return { slot: -1, blockIndex: -1 };
}

// ---------------------------------------------------------------- 追加式注入
function blockOffset(archive, index) {
  const at = index * 16;
  const low = archive.blockTable.readUInt32LE(at);
  const high = archive.hasHigh ? archive.hiBlockTable.readUInt16LE(index * 2) : 0;
  return high * 0x100000000 + low;
}
function blockField(archive, index, field) { return archive.blockTable.readUInt32LE(index * 16 + field * 4); }

// 回滚信息：header 原字节 + 原文件长度；任何时候都能一字不差地还原
function captureRollback(archive) {
  return {
    headerHex: archive.headerRaw.toString('hex'),
    headerSize: archive.headerRaw.length,
    originalSize: archive.size,
    headerOffset: archive.headerOffset,
    file: archive.file,
  };
}
function writeRollback(state) {
  const header = Buffer.from(state.headerHex, 'hex');
  const handle = fs.openSync(state.file, 'r+');
  try {
    fs.writeSync(handle, header, 0, header.length, state.headerOffset);
    fs.ftruncateSync(handle, state.originalSize);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
}

// 把 content 注入为 arcName（例如 'DBFilesClient\\Spell.dbc'）。
// 只替换归档里已存在的文件；options.dryRun 只检查不写。
function injectFile(file, arcName, content, { dryRun = false } = {}) {
  const archive = openArchive(file, { writable: !dryRun });
  try {
    const { slot, blockIndex } = findSlot(archive, arcName);
    if (slot < 0 || blockIndex === 0xFFFFFFFF) return { ok: false, reason: 'missing', message: `归档里没有 ${arcName}（本功能只替换，不新增）` };
    const oldOffset = blockOffset(archive, blockIndex);
    const oldArchived = blockField(archive, blockIndex, 1);
    const oldSize = blockField(archive, blockIndex, 2);
    const oldFlags = blockField(archive, blockIndex, 3);
    if (dryRun) return { ok: true, dryRun: true, arcName, oldOffset, oldArchived, oldSize, oldFlags, size: content.length };

    const data = Buffer.from(content);
    const rollback = captureRollback(archive);
    // 1) 新数据追加到当前文件末尾（旧块原地保留，回滚只需写回 header + 截断）
    const newOffset = archive.size;
    // 2) 新表位置：数据之后依次放 hash 表、block 表、hi-block 表
    const newHashPos = newOffset + data.length;
    const newBlockPos = newHashPos + archive.hashEntries * 16;
    const newHiBlockPos = newBlockPos + archive.blockEntries * 16;
    const newTotal = newHiBlockPos + archive.blockEntries * 2;

    // 3) 改写 block 表项：复用原索引，改指向新数据（单块、不压缩、不加密）
    const block = Buffer.from(archive.blockTable);
    const at = blockIndex * 16;
    block.writeUInt32LE(newOffset >>> 0, at);
    block.writeUInt32LE(data.length, at + 4);
    block.writeUInt32LE(data.length, at + 8);
    block.writeUInt32LE((FLAG_EXISTS | FLAG_SINGLE_UNIT) >>> 0, at + 12);
    const hiBlock = Buffer.from(archive.hiBlockTable);
    if (archive.hasHigh) hiBlock.writeUInt16LE(Math.floor(newOffset / 0x100000000) & 0xFFFF, blockIndex * 2);

    // 4) 写数据、写三张表、改 header（只写 headerSize 字节，0x2C 之后是数据区绝不动）
    const handle = archive.fd;
    try {
      fs.writeSync(handle, data, 0, data.length, newOffset);
      const hashEnc = encrypt(archive.hashTable, HASH_TABLE_KEY);
      fs.writeSync(handle, hashEnc, 0, hashEnc.length, newHashPos);
      const blockEnc = encrypt(block, BLOCK_TABLE_KEY);
      fs.writeSync(handle, blockEnc, 0, blockEnc.length, newBlockPos);
      fs.writeSync(handle, hiBlock, 0, hiBlock.length, newHiBlockPos);

      const header = Buffer.from(archive.headerRaw);
      header.writeUInt32LE(newTotal >>> 0, 8);
      header.writeUInt32LE(newHashPos >>> 0, 16);
      header.writeUInt32LE(newBlockPos >>> 0, 20);
      if (archive.headerRaw.length >= 0x2C) {
        header.writeBigUInt64LE(BigInt(newHiBlockPos), 32);
        header.writeUInt16LE(Math.floor(newHashPos / 0x100000000) & 0xFFFF, 40);
        header.writeUInt16LE(Math.floor(newBlockPos / 0x100000000) & 0xFFFF, 42);
      }
      fs.writeSync(handle, header, 0, header.length, archive.headerOffset);
      fs.fsyncSync(handle);
    } catch (error) {
      try { writeRollback(rollback); } catch {}
      throw error;
    }
    return { ok: true, arcName, oldOffset, oldArchived, oldSize, newOffset, size: data.length, total: newTotal, rollback };
  } finally {
    closeArchive(archive);
  }
}

//By leewheel 2026年11月5日 只读条目的基本信息（不解压、不写盘）：更新包用它判断“这张表在档里变了没有”。
// 返回 { size（解压后大小）, archived（档内占用）, flags, offset }；没有该条目返回 null。
// 注意：MPQ 格式本身不保存条目修改时间，只有内容指纹可用（size/flags，必要时再比内容哈希）。
function entryInfo(file, arcName) {
  const archive = openArchive(file);
  try {
    const { slot, blockIndex } = findSlot(archive, arcName);
    if (slot < 0 || blockIndex === 0xFFFFFFFF) return null;
    return {
      size: blockField(archive, blockIndex, 2),
      archived: blockField(archive, blockIndex, 1),
      flags: blockField(archive, blockIndex, 3),
      offset: blockOffset(archive, blockIndex),
    };
  } finally {
    closeArchive(archive);
  }
}

//By leewheel 2026年11月5日 真正把条目读出来（支持压缩）：更新包要“只发变了的条目”，
// 不能整档替换（一个档 200MB+）。压缩方法按 MPQ 惯例，压缩块首字节是掩码：
//   0x02 zlib / 0x08 pkware / 0x01 huffman / 0x10 bzip2 —— 这里只处理 zlib（本客户端用这个），
//   其它方法返回 null，让调用方退化成“按已知名单比大小”，不会瞎猜。
function decompressStorm(raw) {
  if (!raw.length) return Buffer.alloc(0);
  const mask = raw[0];
  const body = raw.subarray(1);
  if (mask & 0x02) {
    try { return require('node:zlib').inflateSync(body); } catch { /* 再试 raw deflate */ }
    try { return require('node:zlib').inflateRawSync(body); } catch { return null; }
  }
  return null;
}

function readEntry(file, arcName) {
  const archive = openArchive(file);
  try {
    const { blockIndex } = findSlot(archive, arcName);
    if (blockIndex < 0 || blockIndex === 0xFFFFFFFF) return null;
    const offset = blockOffset(archive, blockIndex);
    const size = blockField(archive, blockIndex, 2);
    const archived = blockField(archive, blockIndex, 1);
    const flags = blockField(archive, blockIndex, 3);
    if (!(flags & FLAG_COMPRESS)) {                                   // 未压缩：整块直读
      const plain = archive.readAt(offset, size);
      return plain || null;
    }
    if (flags & FLAG_SINGLE_UNIT) {                                   // 单块压缩
      const raw = archive.readAt(offset, archived);
      const inflated = raw && decompressStorm(raw);
      return inflated ? inflated.subarray(0, size) : null;
    }
    // 多扇区压缩：块开头是 (扇区数 + 1) 个 4 字节偏移表，每个扇区单独压
    const sectorSize = archive.sectorSize || 4096;
    const sectors = Math.ceil(size / sectorSize);
    const table = archive.readAt(offset, (sectors + 1) * 4);
    if (!table) return null;
    const parts = [];
    for (let i = 0; i < sectors; i++) {
      const start = table.readUInt32LE(i * 4);
      const end = table.readUInt32LE((i + 1) * 4);
      if (end === start) { parts.push(Buffer.alloc(sectorSize)); continue; }   // 空扇区＝全零
      const raw = archive.readAt(offset + start, end - start);
      if (!raw) return null;
      const plain = (end - start) === sectorSize ? raw : decompressStorm(raw);
      if (!plain) return null;
      parts.push(plain);
    }
    return Buffer.concat(parts).subarray(0, size);
  } catch {
    return null;
  } finally { closeArchive(archive); }
}

//By leewheel 2026年11月5日 批量读（快版）：先查每个条目的位置/大小/标志，再把整档一次性读进内存切片。
// 逐条 readAt 在 1 万条目时会变成几万次小读（实测 85 秒/档），整档读入后只需要几秒。
function readMany(file, names) {
  const out = new Map();
  let archive = null;
  const metas = [];
  try {
    archive = openArchive(file);
    for (const name of names) {
      const { blockIndex } = findSlot(archive, name);
      if (blockIndex < 0 || blockIndex === 0xFFFFFFFF) continue;
      metas.push({
        name,
        offset: blockOffset(archive, blockIndex),
        plain: blockField(archive, blockIndex, 2),
        archived: blockField(archive, blockIndex, 1),
        flags: blockField(archive, blockIndex, 3),
        sector: archive.sectorSize || 4096,
      });
    }
  } catch {
    return out;
  } finally {
    if (archive) closeArchive(archive);
  }
  if (!metas.length) return out;
  let whole = null;
  try { whole = fs.readFileSync(file); } catch { return out; }
  for (const meta of metas) {
    try {
      const { offset, plain, archived, flags, sector } = meta;
      if (!(flags & FLAG_COMPRESS)) {
        if (offset + plain <= whole.length) out.set(meta.name, whole.subarray(offset, offset + plain));
        continue;
      }
      if (flags & FLAG_SINGLE_UNIT) {
        const inflated = decompressStorm(whole.subarray(offset, offset + archived));
        if (inflated) out.set(meta.name, inflated.subarray(0, plain));
        continue;
      }
      const sectors = Math.ceil(plain / sector);
      const parts = [];
      let ok = true;
      for (let i = 0; i < sectors; i++) {
        const from = whole.readUInt32LE(offset + i * 4);
        const to = whole.readUInt32LE(offset + (i + 1) * 4);
        if (to === from) { parts.push(Buffer.alloc(sector)); continue; }
        const raw = whole.subarray(offset + from, offset + to);
        const piece = (to - from) === sector ? raw : decompressStorm(raw);
        if (!piece) { ok = false; break; }
        parts.push(piece);
      }
      if (ok) out.set(meta.name, Buffer.concat(parts).subarray(0, plain));
    } catch { /* 单条失败不影响其它 */ }
  }
  return out;
}

//By leewheel 2026年11月5日 批量取条目元信息（size/archived/flags），只解析表头、不解压：
// 更新包先用它判断“哪些条目变了”，再只读那几条的内容——1 万条目几秒就够。
function entryMeta(file, names) {
  const out = new Map();
  let archive = null;
  try {
    archive = openArchive(file);
    for (const name of names) {
      const { blockIndex } = findSlot(archive, name);
      if (blockIndex < 0 || blockIndex === 0xFFFFFFFF) continue;
      out.set(name.toLowerCase(), {
        name,
        plain: blockField(archive, blockIndex, 2),
        archived: blockField(archive, blockIndex, 1),
        flags: blockField(archive, blockIndex, 3),
      });
    }
  } catch {
    return out;
  } finally {
    if (archive) closeArchive(archive);
  }
  return out;
}

// 归档里所有文件名：MPQ 没有文件名表，但通常带 (listfile)（本身可能压缩）
function entryList(file) {
  const buffer = readEntry(file, '(listfile)');
  if (!buffer) return null;
  const names = buffer.toString('utf8').split(/\r?\n/).map(name => name.trim()).filter(Boolean);
  return names.length ? names : null;
}

// 把归档里的文件读出来（只处理"不压缩、单块、不加密"的块；其余情况返回 null）
function extractPlain(file, arcName) {
  const archive = openArchive(file);
  try {
    const { blockIndex } = findSlot(archive, arcName);
    if (blockIndex < 0 || blockIndex === 0xFFFFFFFF) return null;
    const offset = blockOffset(archive, blockIndex);
    const size = blockField(archive, blockIndex, 2);
    const archived = blockField(archive, blockIndex, 1);
    const flags = blockField(archive, blockIndex, 3);
    if (size !== archived || (flags & FLAG_SINGLE_UNIT) === 0) return null;
    return archive.readAt(offset, size);
  } finally { closeArchive(archive); }
}

// 诊断用：列出被占用的 hash 槽位（归档里没有文件名，只有 (listfile) 才有名字）
function listFiles(file) {
  const archive = openArchive(file);
  try {
    const names = [];
    for (let i = 0; i < archive.hashEntries; i++) {
      const block = archive.hashTable.readUInt32LE(i * 16 + 12);
      if (block !== 0xFFFFFFFF && block < archive.blockEntries) names.push({ slot: i, block });
    }
    return names;
  } finally { closeArchive(archive); }
}

module.exports = { isMpqFile, openArchive, closeArchive, readArchive, findSlot, entryInfo, entryMeta, readEntry, readMany, entryList, injectFile, extractPlain, listFiles, hashString, captureRollback, writeRollback };
