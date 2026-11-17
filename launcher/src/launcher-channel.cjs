'use strict';
//By leewheel 2026年11月17日 启动器双渠道（老大 2026-11-17 要求）：两个版本各自独立更新、互不干扰。
//  · plain（标准版）：不带「By Me Some Token」按钮。清单 launcher-release.json，Release 标题 COA-LAUNCHER-<版本号>，
//    资产 CoA-Launcher-<版本号>.exe，tag = <版本号>。这就是一直以来的发版形态，老启动器照旧能收到更新。
//  · token（捐赠版）：保留「By Me Some Token」按钮。清单 launcher-release-token.json，Release 标题 COA-TOKEN-<版本号>，
//    资产 CoA-Launcher-Token-<版本号>.exe，tag = token-<版本号>。
//    🔴 标题刻意**不用** COA-LAUNCHER- 开头：已发布的普通版老启动器只认这个前缀（launcher-selfupdate 里
//    的标题匹配），标题若以它开头，普通版玩家会被提示“升级”成捐赠版。用 COA-TOKEN- 前缀能把两者彻底隔开。
// 渠道是**构建期**写进 package.json 的 coaChannel 字段（scripts/set-channel.cjs 负责写），
// 运行期从打包进去的 package.json 读回来，界面与自更新都按它走。
const CHANNELS = {
  plain: {
    key: 'plain',
    label: '标准版',
    manifest: 'launcher-release.json',
    titlePrefix: 'COA-LAUNCHER-',
    tagOf: version => String(version),
    assetOf: version => `CoA-Launcher-${version}.exe`,
  },
  token: {
    key: 'token',
    label: '捐赠版',
    manifest: 'launcher-release-token.json',
    titlePrefix: 'COA-TOKEN-',
    tagOf: version => `token-${version}`,
    assetOf: version => `CoA-Launcher-Token-${version}.exe`,
  },
};

// 认不出来的渠道一律当标准版：宁可少一个打赏按钮，也不能让普通版玩家拿到捐赠版的行为。
function channelOf(value) {
  const key = String(value || '').trim().toLowerCase();
  return CHANNELS[key] || CHANNELS.plain;
}

module.exports = { CHANNELS, channelOf };
