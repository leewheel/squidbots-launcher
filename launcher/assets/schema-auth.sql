# By leewheel 2026年11月6日 启动器自带建表脚本（pending_db_auth，只含 CREATE TABLE IF NOT EXISTS，可重复执行）。
# 用途：核心的数据库自动更新被关闭（Updates.EnableDatabases = 0），新版本新增的表由启动器兜底创建，
# 否则世界服在 mysql_stmt_prepare 阶段会报 “Table ... doesn't exist” 并退出。
# End By leewheel
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS `raf_accounts` (
  `account_id` INT UNSIGNED NOT NULL,
  `started_at` BIGINT UNSIGNED NOT NULL,
  `validated_at` BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raf_progress` (
  `account_id` INT UNSIGNED NOT NULL,
  `realm_id` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `baseline_time` BIGINT UNSIGNED NOT NULL,
  `played_time` BIGINT UNSIGNED NOT NULL,
  `session_token` BIGINT UNSIGNED NOT NULL,
  `qualified_seconds` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`account_id`, `realm_id`, `guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raf_claims` (
  `claim_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` INT UNSIGNED NOT NULL,
  `reward_id` INT UNSIGNED NOT NULL,
  `realm_id` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `item_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `delivered_at` BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`claim_id`),
  UNIQUE KEY `account_reward` (`account_id`, `reward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raf_link_lock` (
  `id` TINYINT UNSIGNED NOT NULL,
  `generation` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raf_recruit_claims` (
  `claim_id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account_id` INT UNSIGNED NOT NULL,
  `reward_id` INT UNSIGNED NOT NULL,
  `realm_id` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `item_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL,
  `created_at` BIGINT UNSIGNED NOT NULL,
  `delivered_at` BIGINT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (`claim_id`),
  UNIQUE KEY `account_realm_reward` (`account_id`, `realm_id`, `reward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
