#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
COA 更新包打包器 —— DBC 双发布、强制进 ZZN、只留最终版本

规则来源：老大 2026-11-26 定案
  1. 所有 DBC 修改必须【同时】注入客户端补丁档 + 拷贝到服务端 ClientData\\dbc。
  2. 🔴 改过的 DBC 一律放进 patch-ZZN.mpq。唯一例外是加载比 ZZN 更晚的语言档
     （enUS\\ 下的 MPQ 最晚加载），那些放回它自己的语言档，不进 ZZN。
     理由：ZZN 是最后加载的补丁档，放这里就一定能盖掉 patch-M / patch-S / patch-ZG 里的旧版本，
     绝不会出现“两个版本不知道哪个生效”。散放在别的档里才需要担心覆盖顺序。
  3. 同一个表名只允许一份最终版本：工具会自动把散落在 patch-M / patch-S / patch-ZG 的改表
     搬到 patch-ZZN.mpq，同名冲突按“文件时间新的赢”定，输的移到包外的 _pruned\\ 留证。
  4. 包内 Server\\ClientData\\dbc 下的 DBC 一律不放 —— 安装时由客户端载荷生成，
     包里留一份只会变成“第二版本”，直接剔掉。
  5. 这些都在打包这一步做完，绝不把“包里有问题”留给玩家去承受。

用法：
  python tools/pack-update.py <包内容根目录> [<输出.zip>] [--name <包内顶层名>] [--audit-only] [--no-relocate] [--no-zip]

  --audit-only   只审计与列出将要做的搬迁/剔除，不动文件、不打包
  --no-relocate  不自动搬进 ZZN，只报告（默认就是搬）
  --no-zip       只做搬迁与清理，不产 zip

作者：leewheel
"""

import argparse
import hashlib
import os
import shutil
import sys
import zipfile

# By leewheel 2026年11月26日 语言子目录各算一组：客户端与服务端都按 locale 分开加载，
# 语言目录之间允许同名；同一组内才讲“只留最终版本”。
LOCALE_DIRS = {
    'enus', 'zhcn', 'zhtw', 'dede', 'frfr', 'eses', 'esmx',
    'ruru', 'kokr', 'ptbr', 'itit',
}

# By leewheel 2026年11月26日 强制目标档：改过的 DBC 全进这里（ZZN 最后加载）
FORCED_ARCHIVE = 'patch-ZZN.mpq'

# 包内可能放 DBC 的目录（相对包内容根），与启动器 release-update.cjs 的 dbcCandidates 对齐
DBC_CANDIDATE_DIRS = [
    os.path.join('client', 'data', 'dbc'),
    os.path.join('client', 'Data', 'dbc'),
    os.path.join('Client', 'Data', 'dbc'),
    os.path.join('Client', 'data', 'dbc'),
    'dbc',
    'chsspell',
]

# 包内不该放 DBC 的地方（服务端副本由安装时生成），出现即剔除
SERVER_DATA_DIRS = [
    os.path.join('server', 'ClientData'),
    os.path.join('Server', 'ClientData'),
    os.path.join('server', 'Data'),
    os.path.join('Server', 'Data'),
]


def md5_of(path):
    h = hashlib.md5()
    with open(path, 'rb') as handle:
        while True:
            chunk = handle.read(1 << 22)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def walk_dbc(root):
    for current, _dirs, names in os.walk(root):
        for name in names:
            if name.lower().endswith('.dbc'):
                yield os.path.join(current, name)


def existing_dirs(package_root, relatives):
    found, seen = [], set()
    for rel in relatives:
        path = os.path.join(package_root, rel)
        if not os.path.isdir(path):
            continue
        key = os.path.normcase(os.path.abspath(path))
        if key in seen:
            continue
        seen.add(key)
        found.append(path)
    return found


def describe(path, base):
    """拆出 (相对路径, locale, 档名前的子目录, 档名, 表名)。"""
    rel = os.path.relpath(path, base)
    parts = rel.split(os.sep)
    table = parts[-1]
    mpq_at = -1
    for index, part in enumerate(parts):
        if part.lower().endswith('.mpq'):
            mpq_at = index
            break
    sub = parts[:mpq_at] if mpq_at >= 0 else []
    archive = parts[mpq_at] if mpq_at >= 0 else ''
    locale = sub[0].lower() if sub and sub[0].lower() in LOCALE_DIRS else ''
    return rel, locale, sub, archive, table


def collect(package_root):
    entries = []
    for base in existing_dirs(package_root, DBC_CANDIDATE_DIRS):
        for path in walk_dbc(base):
            rel, locale, sub, archive, table = describe(path, base)
            entries.append({
                'base': base,
                'path': path,
                'rel': rel.replace(os.sep, '/'),
                'locale': locale,
                'sub': sub,
                'archive': archive,
                'table': table,
                'size': os.path.getsize(path),
                'md5': '',
            })
    return entries


def prune_root(package_root):
    root = os.path.abspath(package_root)
    return root.rstrip(os.sep) + '_pruned'


def move_out(package_root, path):
    """把文件移到包外的 _pruned\\，保留原相对路径。"""
    root = os.path.abspath(package_root)
    rel = os.path.relpath(path, root)
    target = os.path.join(prune_root(package_root), rel)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        os.remove(target)
    shutil.move(path, target)
    return target


def cleanup_empty(package_root):
    """搬空后的目录顺手删掉，包里不留空的 patch-X.mpq\\。"""
    root = os.path.abspath(package_root)
    for current, _dirs, _names in os.walk(root, topdown=False):
        if os.path.abspath(current) == root:
            continue
        try:
            if not os.listdir(current):
                os.rmdir(current)
        except OSError:
            pass


def relocate_to_zzn(package_root, entries):
    """规则二：语言目录以外的 DBC 全部搬进 patch-ZZN.mpq。返回 (搬迁, 淘汰, 冲突)。"""
    relocated, dropped, conflicts = [], [], []
    for entry in entries:
        if entry['locale']:
            # 语言档（enUS\\ 等）加载比 ZZN 晚，保持它自己的档，不进 ZZN
            continue
        if entry['archive'].lower() == FORCED_ARCHIVE.lower():
            continue
        dest_dir = os.path.join(entry['base'], FORCED_ARCHIVE)
        dest = os.path.join(dest_dir, entry['table'])
        os.makedirs(dest_dir, exist_ok=True)
        if not os.path.exists(dest):
            shutil.move(entry['path'], dest)
            relocated.append((entry, entry['archive'] or '自动选档'))
            entry['path'] = dest
            entry['archive'] = FORCED_ARCHIVE
            entry['rel'] = os.path.relpath(dest, entry['base']).replace(os.sep, '/')
            entry['sub'] = []
            continue

        # 目标档里已经有同名表：两份只有一个能留，按文件时间定最终版本
        src_md5 = md5_of(entry['path'])
        dst_md5 = md5_of(dest)
        if src_md5 == dst_md5:
            target = move_out(package_root, entry['path'])
            dropped.append((entry, target, 'from', '内容相同'))
            continue
        src_time = os.path.getmtime(entry['path'])
        dst_time = os.path.getmtime(dest)
        if src_time >= dst_time:
            target = move_out(package_root, dest)
            shutil.move(entry['path'], dest)
            conflicts.append((entry, target, '原 ZZN 里的旧版被更新版替换'))
            entry['path'] = dest
            entry['archive'] = FORCED_ARCHIVE
            entry['rel'] = os.path.relpath(dest, entry['base']).replace(os.sep, '/')
            entry['sub'] = []
        else:
            target = move_out(package_root, entry['path'])
            conflicts.append((entry, target, '包里的旧版被 ZZN 里更新的版本替换'))
    return relocated, dropped, conflicts


def decide(entries):
    """语言目录内才可能残留同名；同一组内只留最终版本。"""
    groups = {}
    for entry in entries:
        groups.setdefault((entry['locale'], entry['table'].lower()), []).append(entry)
    kept, pruned, problems = [], [], []
    for (_locale, _table), items in sorted(groups.items()):
        items.sort(key=lambda row: (row['archive'].lower(), row['base'].lower()))
        winner = items[-1]
        kept.append(winner)
        for item in items[:-1]:
            if item['archive'].lower() == winner['archive'].lower():
                problems.append(
                    '同一个档目录里出现两份 {table}：{a} / {b}，无法判断谁生效，请合并'.format(
                        table=winner['table'], a=item['rel'], b=winner['rel'])
                )
                continue
            item['replaced_by'] = winner['rel']
            item['same_content'] = (item['md5'] or md5_of(item['path'])) == (winner['md5'] or md5_of(winner['path']))
            pruned.append(item)
    return kept, pruned, problems


def check_server_copies(package_root, kept):
    """规则四：包内 Server\\ClientData\\dbc 的 DBC 一律剔掉，安装时由客户端载荷生成。"""
    payload = {(entry['locale'], entry['table'].lower()): entry for entry in kept}
    removed, warnings = [], []
    for server_dir in existing_dirs(package_root, SERVER_DATA_DIRS):
        dbc_dir = os.path.join(server_dir, 'dbc')
        if not os.path.isdir(dbc_dir):
            continue
        for path in walk_dbc(dbc_dir):
            rel = os.path.relpath(path, dbc_dir)
            parts = rel.split(os.sep)
            table = parts[-1]
            locale = parts[0].lower() if len(parts) > 1 and parts[0].lower() in LOCALE_DIRS else ''
            twin = payload.get((locale, table.lower()))
            if not twin:
                warnings.append(
                    '{rel} 只在服务端有、客户端载荷里没有，安装后不会出现在服务端，请确认这张表该怎么发'.format(
                        rel=rel.replace(os.sep, '/'))
                )
                continue
            target = move_out(package_root, path)
            removed.append((path, target, twin))
    return removed, warnings


def manifest_text(kept, relocated, dropped, conflicts, server_removed):
    lines = [
        '# COA 更新包 DBC 清单（打包时生成）',
        '# 规则：改过的 DBC 全进 patch-ZZN.mpq（最后加载），语言档（enUS 等）除外；同名只留最终版本。',
        '# 表名 | 目标补丁档 | 大小(字节) | md5 | 服务端落点(相对 <Server>/<DataDir>/dbc)',
    ]
    for item in sorted(kept, key=lambda row: (row['locale'], row['table'].lower())):
        server_rel = '/'.join(list(item['sub']) + [item['table']])
        lines.append('{table} | {archive} | {size} | {md5} | {server}'.format(
            table=item['table'],
            archive=item['archive'] or '自动选档',
            size=item['size'],
            md5=item['md5'],
            server=server_rel,
        ))
    if relocated:
        lines.append('')
        lines.append('# 打包时搬进 patch-ZZN.mpq（原来放错了档）')
        for item, from_archive in relocated:
            lines.append('{table} | {src} → {dst}'.format(
                table=item['table'], src=from_archive, dst=FORCED_ARCHIVE))
    if dropped or conflicts:
        lines.append('')
        lines.append('# 打包时淘汰的旧版本（搬到包外的 _pruned 目录，不随包发布）')
        for item, target, _why, verdict in dropped:
            lines.append('{rel} | {verdict} | 备份 {backup}'.format(
                rel=item['rel'], verdict=verdict,
                backup=os.path.relpath(target, os.path.dirname(os.path.abspath(target)))))
        for item, target, why in conflicts:
            lines.append('{rel} | {why} | 备份 {backup}'.format(
                rel=item['rel'], why=why, backup=os.path.basename(target)))
    if server_removed:
        lines.append('')
        lines.append('# 打包时剔除的服务端冗余副本（安装时由客户端载荷生成）')
        for path, _target, twin in server_removed:
            lines.append('{rel} | 改由 {client} 生成'.format(
                rel=os.path.basename(path), client=twin['rel']))
    return '\n'.join(lines) + '\n'


def pack(package_root, zip_path, name, manifest):
    base = os.path.abspath(package_root)
    top = name or os.path.basename(base)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for current, _dirs, names in os.walk(base):
            for filename in sorted(names):
                full = os.path.join(current, filename)
                rel = os.path.relpath(full, base).replace(os.sep, '/')
                archive.write(full, '{}/{}'.format(top, rel))
        archive.writestr('{}/DBC-MANIFEST.txt'.format(top), manifest)
    return zip_path


def main():
    parser = argparse.ArgumentParser(description='COA 更新包打包：DBC 双发布 + 强制进 ZZN + 只留最终版本')
    parser.add_argument('package_root', help='包内容根目录（含 client\\ server\\ configs\\ 的那一层）')
    parser.add_argument('zip_out', nargs='?', default='', help='输出 zip（默认同级的 <目录名>.zip）')
    parser.add_argument('--name', default='', help='zip 内顶层目录名（默认用源目录名）')
    parser.add_argument('--audit-only', action='store_true', help='只审计，不动文件、不打包')
    parser.add_argument('--no-relocate', action='store_true', help='不自动搬进 ZZN，只报告')
    parser.add_argument('--no-zip', action='store_true', help='只做搬迁与清理，不产 zip')
    args = parser.parse_args()

    package_root = os.path.abspath(args.package_root)
    if not os.path.isdir(package_root):
        print('包目录不存在：{}'.format(package_root))
        return 2

    entries = collect(package_root)
    if not entries:
        print('包内没有 DBC（client\\data\\dbc 等目录都为空），本包不含 DBC 修改')
        return 0

    strays = [entry for entry in entries
              if not entry['locale'] and entry['archive'].lower() != FORCED_ARCHIVE.lower()]
    print('== DBC 审计：{} 张表，其中 {} 张不在 {} =='.format(len(entries), len(strays), FORCED_ARCHIVE))
    for entry in sorted(strays, key=lambda row: row['table'].lower()):
        print('  位置不对  {rel:<52} 应为 {dst}/{table}'.format(
            rel=entry['rel'], dst=FORCED_ARCHIVE, table=entry['table']))

    if args.audit_only:
        print('\n== 预览结束（未改动文件）==')
        return 0

    relocated, dropped, conflicts = [], [], []
    if strays and not args.no_relocate:
        relocated, dropped, conflicts = relocate_to_zzn(package_root, entries)
        cleanup_empty(package_root)
        print('已搬进 {}：{} 张；淘汰旧版 {} 张'.format(
            FORCED_ARCHIVE, len(relocated), len(dropped) + len(conflicts)))
        entries = collect(package_root)
    elif strays:
        print('\n== 有 {} 张表不在 ZZN，按 --no-relocate 未搬，禁止打包 =='.format(len(strays)))
        return 1

    kept, pruned, problems = decide(entries)
    if pruned:
        for item in pruned:
            move_out(package_root, item['path'])
        cleanup_empty(package_root)
        accepted = [item for item in kept]
        kept = accepted
        print('语言档内淘汰同名旧版 {} 张'.format(len(pruned)))

    if problems:
        print('\n== 审计不通过：包结构本身有问题，必须人工处理 ==')
        for index, problem in enumerate(problems, 1):
            print('  {}. {}'.format(index, problem))
        return 1

    kept, pruned_again, problems = decide(collect(package_root))
    server_removed, warnings = check_server_copies(package_root, kept)
    if server_removed:
        print('已剔掉服务端冗余副本 {} 张（安装时由客户端载荷生成）'.format(len(server_removed)))
    for warning in warnings:
        print('警告：{}'.format(warning))

    for entry in kept:
        if not entry['md5']:
            entry['md5'] = md5_of(entry['path'])
    print('\n== 最终 DBC 清单 ==')
    for item in sorted(kept, key=lambda row: (row['locale'], row['table'].lower())):
        print('  {table:<32} 档 {archive:<16} {size:>10} 字节'.format(
            table=item['table'], archive=item['archive'], size=item['size']))

    manifest = manifest_text(kept, relocated, dropped, conflicts, server_removed)
    if args.no_zip:
        print('\n搬迁与清理完成（--no-zip，未打包）')
        return 0
    zip_out = args.zip_out or os.path.join(os.path.dirname(package_root),
                                           os.path.basename(package_root) + '.zip')
    if os.path.exists(zip_out):
        os.remove(zip_out)
    pack(package_root, zip_out, args.name, manifest)
    print('\n打包完成：{}（{:.1f} MB）'.format(zip_out, os.path.getsize(zip_out) / 1024 / 1024))
    print('DBC 清单已随包写入 DBC-MANIFEST.txt')
    return 0


if __name__ == '__main__':
    sys.exit(main())
