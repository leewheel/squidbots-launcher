# By leewheel 2026年11月6日 启动器自带建表脚本（pending_db_characters，只含 CREATE TABLE IF NOT EXISTS，可重复执行）。
# 用途：核心的数据库自动更新被关闭（Updates.EnableDatabases = 0），新版本新增的表由启动器兜底创建，
# 否则世界服在 mysql_stmt_prepare 阶段会报 “Table ... doesn't exist” 并退出。
# End By leewheel
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS `player_anticheat_alert` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `account` int unsigned NOT NULL,
  `guid` int unsigned NOT NULL DEFAULT 0,
  `name` varchar(32) NOT NULL DEFAULT '',
  `reason` varchar(64) NOT NULL,
  `details` varchar(512) NOT NULL DEFAULT '',
  `size` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_player_anticheat_alert_guid` (`guid`),
  KEY `idx_player_anticheat_alert_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `character_appearance_outfit` (
    `guid` INT UNSIGNED NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `appearances` TEXT NOT NULL,
    PRIMARY KEY (`guid`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `ascension_player_ticket` (
    `id` INT UNSIGNED NOT NULL,
    `account` INT UNSIGNED NOT NULL,
    `creator_guid` INT UNSIGNED NOT NULL,
    `creator` VARCHAR(12) NOT NULL,
    `title` VARCHAR(128) NOT NULL,
    `category` TINYINT UNSIGNED NOT NULL,
    `priority` TINYINT UNSIGNED NOT NULL,
    `affected_character` VARCHAR(32) NOT NULL,
    `status` TINYINT UNSIGNED NOT NULL,
    `assigned_to` VARCHAR(12) NOT NULL DEFAULT '',
    `closed_by_creator` TINYINT UNSIGNED NOT NULL DEFAULT 0,
    `created` INT UNSIGNED NOT NULL,
    `closed` INT UNSIGNED NOT NULL DEFAULT 0,
    `locale` VARCHAR(4) NOT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_account` (`account`, `closed_by_creator`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `ascension_player_ticket_message` (
    `ticket` INT UNSIGNED NOT NULL,
    `id` INT UNSIGNED NOT NULL,
    `from_gm` TINYINT UNSIGNED NOT NULL,
    `gm_only` TINYINT UNSIGNED NOT NULL,
    `sender` VARCHAR(12) NOT NULL,
    `message` TEXT NOT NULL,
    `created` INT UNSIGNED NOT NULL,
    `read_by` VARCHAR(12) NOT NULL DEFAULT '',
    `read_at` INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`ticket`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `raf_reward_delivery` (
  `claim_id` BIGINT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `mail_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`claim_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `character_manastorm_weekly_cache` (
  `guid` INT UNSIGNED NOT NULL,
  `reset_time` INT UNSIGNED NOT NULL,
  `cache_number` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`guid`, `reset_time`, `cache_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `character_manastorm_stage_receipt` (
  `guid` INT UNSIGNED NOT NULL,
  `run_seed` BIGINT UNSIGNED NOT NULL,
  `run_id` BIGINT UNSIGNED NOT NULL,
  `depth` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`guid`, `run_seed`, `run_id`, `depth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `manastorm_weekly_cache_lockout` (
  `guid` INT UNSIGNED NOT NULL,
  `reset_at` INT UNSIGNED NOT NULL,
  `caches_received` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`),
  CONSTRAINT `chk_manastorm_weekly_reset` CHECK (`reset_at` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ascension_manastorm_clear` (
  `guid` int unsigned NOT NULL,
  `mode` tinyint unsigned NOT NULL,
  `depth` int unsigned NOT NULL,
  `scene` int unsigned NOT NULL,
  `mail_id` int unsigned NOT NULL,
  `completed_at` int unsigned NOT NULL,
  PRIMARY KEY (`guid`, `mode`, `depth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ascension_manastorm_bonus` (
  `guid` int unsigned NOT NULL,
  `mode` tinyint unsigned NOT NULL,
  `pity` int unsigned NOT NULL DEFAULT 0,
  `caches` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ascension_manastorm_xp` (
  `guid` int unsigned NOT NULL,
  `amount` bigint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ascension_manastorm_loadout` (
  `guid` int unsigned NOT NULL,
  `slot` tinyint unsigned NOT NULL,
  `spell` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ascension_manastorm_cache` (
  `item` int unsigned NOT NULL,
  `guid` int unsigned NOT NULL,
  PRIMARY KEY (`item`),
  KEY `idx_guid` (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_account_warchest` (
  `account` INT UNSIGNED NOT NULL,
  `claimed_at` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`account`)
);

CREATE TABLE IF NOT EXISTS `coa_keepers_scroll_blessing` (
  `zone` INT UNSIGNED NOT NULL,
  `instance` INT UNSIGNED NOT NULL,
  `spell` INT UNSIGNED NOT NULL,
  `caster` INT UNSIGNED NOT NULL,
  `team` TINYINT UNSIGNED NOT NULL,
  `expire_at` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`zone`, `instance`, `spell`, `caster`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `coa_wildcard_skill_card` (
  `account` INT UNSIGNED NOT NULL,
  `card` INT UNSIGNED NOT NULL,
  `pending` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`account`, `card`)
);

CREATE TABLE IF NOT EXISTS `coa_wildcard_skill_card_pending` (
  `account` INT UNSIGNED NOT NULL,
  `id` INT UNSIGNED NOT NULL,
  `card` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`account`, `id`)
);

CREATE TABLE IF NOT EXISTS `coa_wildcard_skill_card_account` (
  `account` INT UNSIGNED NOT NULL,
  `bonus_progress` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`account`)
);

CREATE TABLE IF NOT EXISTS `coa_wildcard_skill_card_purchase` (
  `account` INT UNSIGNED NOT NULL,
  `type` TINYINT UNSIGNED NOT NULL,
  `count` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`account`, `type`)
);

CREATE TABLE IF NOT EXISTS `coa_wildcard_specialization_cache` (
  `account` INT UNSIGNED NOT NULL,
  `claimed_at` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`account`)
);

CREATE TABLE IF NOT EXISTS `coa_mc_fire_lord_cache_tier` (
  `ItemGuid` INT UNSIGNED NOT NULL,
  `RaidDifficulty` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (`ItemGuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_scaled_item` (
  `entry` INT UNSIGNED NOT NULL,
  `base_entry` INT UNSIGNED NOT NULL,
  `lift` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`entry`),
  UNIQUE KEY `base_lift` (`base_entry`, `lift`)
);

CREATE TABLE IF NOT EXISTS `coa_mystic_enchant` (
  `guid` INT UNSIGNED NOT NULL,
  `progress` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `level` INT UNSIGNED NOT NULL DEFAULT 1,
  `active_preset` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `preset_count` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_mystic_enchant_known` (
  `guid` INT UNSIGNED NOT NULL,
  `spell` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`guid`, `spell`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_mystic_enchant_slot` (
  `guid` INT UNSIGNED NOT NULL,
  `preset` TINYINT UNSIGNED NOT NULL,
  `slot` TINYINT UNSIGNED NOT NULL,
  `spell` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`guid`, `preset`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_crows_cache` (
    `id` INT UNSIGNED NOT NULL,
    `phase` TINYINT UNSIGNED NOT NULL,
    `carrier` INT UNSIGNED NOT NULL DEFAULT 0,
    `item_guid` INT UNSIGNED NOT NULL DEFAULT 0,
    `map` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    `x` FLOAT NOT NULL,
    `y` FLOAT NOT NULL,
    `z` FLOAT NOT NULL,
    `o` FLOAT NOT NULL DEFAULT 0,
    `deadline` BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `character_item_scaling` (
  `item_guid` INT UNSIGNED NOT NULL,
  `item_entry` INT UNSIGNED NOT NULL,
  `scaling_level` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (`item_guid`)
);

CREATE TABLE IF NOT EXISTS `coa_lottery_round` (
  `id` BIGINT UNSIGNED NOT NULL,
  `active` TINYINT UNSIGNED DEFAULT NULL,
  `ends_at` BIGINT UNSIGNED NOT NULL,
  `pot` INT UNSIGNED NOT NULL DEFAULT 0,
  `seed` INT UNSIGNED NOT NULL DEFAULT 0,
  `contribution_percent` INT UNSIGNED NOT NULL DEFAULT 100,
  `duration_seconds` INT UNSIGNED NOT NULL DEFAULT 604800,
  `winner_guid` INT UNSIGNED DEFAULT NULL,
  `payout_mail_id` INT UNSIGNED DEFAULT NULL,
  `bonus_item` INT UNSIGNED NOT NULL DEFAULT 0,
  `fake_tickets` INT UNSIGNED NOT NULL DEFAULT 0,
  `paused` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `paused_remaining` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `one_active_round` (`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_lottery_entry` (
  `round_id` BIGINT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `tickets` INT UNSIGNED NOT NULL,
  `spent_copper` INT UNSIGNED NOT NULL DEFAULT 0,
  `pot_copper` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_id`, `guid`),
  KEY `character_entries` (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_lottery_winner` (
  `round_id` BIGINT UNSIGNED NOT NULL,
  `drawn_at` BIGINT UNSIGNED NOT NULL,
  `winner_guid` INT UNSIGNED NOT NULL,
  `winner_account_id` INT UNSIGNED NOT NULL,
  `winner_name` VARCHAR(64) NOT NULL,
  `gold_copper` INT UNSIGNED NOT NULL,
  `bonus_item` INT UNSIGNED NOT NULL DEFAULT 0,
  `bonus_item_name` VARCHAR(255) NOT NULL DEFAULT '',
  `winner_tickets` INT UNSIGNED NOT NULL,
  `total_tickets` INT UNSIGNED NOT NULL,
  `payout_mail_id` INT UNSIGNED NOT NULL,
  `house_win` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `destroyed_copper` INT UNSIGNED NOT NULL DEFAULT 0,
  `admin_forced` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `complimentary_tickets` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`round_id`),
  KEY `draw_history` (`drawn_at`, `round_id`),
  KEY `character_history` (`winner_guid`, `round_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_lottery_control` (
  `id` TINYINT UNSIGNED NOT NULL,
  `enabled` TINYINT UNSIGNED DEFAULT NULL,
  `auto_start` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_account_challenge_completion` (
    `account` INT UNSIGNED NOT NULL,
    `challengeId` INT UNSIGNED NOT NULL,
    `level` INT UNSIGNED NOT NULL DEFAULT 1,
    `completeTime` INT UNSIGNED NOT NULL DEFAULT 0,
    `startTime` INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`account`, `challengeId`, `level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_build_creator` (
  `entry` INT UNSIGNED NOT NULL,
  `id` VARCHAR(36) NOT NULL,
  `leveling_id` VARCHAR(36) NOT NULL DEFAULT '',
  `pve_id` VARCHAR(36) NOT NULL DEFAULT '',
  `pvp_id` VARCHAR(36) NOT NULL DEFAULT '',
  `class` TINYINT UNSIGNED NOT NULL,
  `owner_account` INT UNSIGNED NOT NULL DEFAULT 0,
  `author` VARCHAR(64) NOT NULL DEFAULT '',
  `name` VARCHAR(128) NOT NULL,
  `subtext` VARCHAR(128) NOT NULL DEFAULT '',
  `description` TEXT NOT NULL,
  `icon` VARCHAR(128) NOT NULL,
  `upvotes` INT UNSIGNED NOT NULL DEFAULT 0,
  `created` BIGINT UNSIGNED NOT NULL,
  `updated` BIGINT UNSIGNED NOT NULL,
  `category` TINYINT UNSIGNED NOT NULL,
  `roles` TINYINT UNSIGNED NOT NULL,
  `primary_stat` TINYINT UNSIGNED NOT NULL,
  `needs_repairs` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `flags` INT UNSIGNED NOT NULL DEFAULT 0,
  `difficulty` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`entry`),
  UNIQUE KEY `build_id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_build_creator_spell` (
  `entry` INT UNSIGNED NOT NULL,
  `slot` SMALLINT UNSIGNED NOT NULL,
  `spell` INT UNSIGNED NOT NULL,
  `level` TINYINT UNSIGNED NOT NULL,
  `core` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `optimal` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `empowering` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `synergistic` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `flags` INT UNSIGNED NOT NULL DEFAULT 0,
  `comment` VARCHAR(128) NOT NULL DEFAULT '',
  PRIMARY KEY (`entry`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_build_creator_enchant` (
  `entry` INT UNSIGNED NOT NULL,
  `slot` SMALLINT UNSIGNED NOT NULL,
  `enchant` INT UNSIGNED NOT NULL,
  `stacks` INT UNSIGNED NOT NULL DEFAULT 1,
  `level` TINYINT UNSIGNED NOT NULL,
  `flags` INT UNSIGNED NOT NULL DEFAULT 0,
  `comment` VARCHAR(128) NOT NULL DEFAULT '',
  PRIMARY KEY (`entry`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_build_creator_item_type` (
  `entry` INT UNSIGNED NOT NULL,
  `armor` TINYINT UNSIGNED NOT NULL,
  `slot` TINYINT UNSIGNED NOT NULL,
  `type` TINYINT UNSIGNED NOT NULL,
  `comment` VARCHAR(128) NOT NULL DEFAULT '',
  PRIMARY KEY (`entry`, `armor`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_build_creator_vote` (
  `entry` INT UNSIGNED NOT NULL,
  `account` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`entry`, `account`),
  KEY `account_votes` (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_build_creator_active` (
  `guid` INT UNSIGNED NOT NULL,
  `spec` TINYINT UNSIGNED NOT NULL,
  `build_id` VARCHAR(36) NOT NULL,
  `flag_1` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `flag_2` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `spec`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `worldforged_account_unlock` (
  `account` INT UNSIGNED NOT NULL,
  `creature` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`account`, `creature`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `grootcoin_award` (
  `award_id` CHAR(36) NOT NULL,
  `issue_number` INT UNSIGNED NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'gm',
  `source_ref` VARCHAR(64) NULL,
  `recipient_account_id` INT UNSIGNED NOT NULL,
  `recipient_character_guid` INT UNSIGNED NOT NULL,
  `actor_account_id` INT UNSIGNED NOT NULL,
  `actor_character_guid` INT UNSIGNED NOT NULL,
  `amount` INT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `attribution_ref` VARCHAR(128) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`award_id`),
  UNIQUE KEY `one_award_per_issue_and_account` (`issue_number`, `recipient_account_id`),
  UNIQUE KEY `one_award_per_source_ref` (`source`, `source_ref`),
  KEY `recipient_character_history` (`recipient_character_guid`, `created_at`),
  KEY `recipient_account_history` (`recipient_account_id`, `created_at`),
  KEY `actor_account_history` (`actor_account_id`, `created_at`),
  KEY `created` (`created_at`),
  CONSTRAINT `grootcoin_award_amount` CHECK (`amount` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `grootcoin_award_mail` (
  `award_id` CHAR(36) NOT NULL,
  `mail_id` INT UNSIGNED NOT NULL,
  `coin_item_guid` INT UNSIGNED NOT NULL,
  `amount` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`award_id`, `mail_id`, `coin_item_guid`),
  KEY `mail` (`mail_id`),
  KEY `coin_item` (`coin_item_guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `grootcoin_exchange` (
  `exchange_id` CHAR(36) NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `character_guid` INT UNSIGNED NOT NULL,
  `coin_entry` INT UNSIGNED NOT NULL,
  `token_entry` INT UNSIGNED NOT NULL,
  `coins_spent` INT UNSIGNED NOT NULL,
  `tokens_delivered` INT UNSIGNED NOT NULL,
  `tokens_per_coin` INT UNSIGNED NOT NULL,
  `source` VARCHAR(32) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`exchange_id`),
  KEY `account_history` (`account_id`, `created_at`),
  KEY `character_history` (`character_guid`, `created_at`),
  KEY `created` (`created_at`),
  CONSTRAINT `grootcoin_exchange_payout` CHECK (`coins_spent` > 0 AND `tokens_delivered` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `groot_coin_award_queue` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `source` VARCHAR(32) NOT NULL,
  `source_ref` VARCHAR(64) NOT NULL,
  `character_guid` INT UNSIGNED NOT NULL,
  `amount` INT UNSIGNED NOT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `requested_by_account` INT UNSIGNED NOT NULL,
  `status` ENUM('pending', 'done', 'failed') NOT NULL DEFAULT 'pending',
  `error` VARCHAR(255) NULL,
  `award_id` CHAR(36) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `one_request_per_source_ref` (`source`, `source_ref`),
  KEY `status` (`status`, `id`),
  CONSTRAINT `groot_coin_award_queue_source` CHECK (`source` <> 'gm')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `raf_recruit_reward_delivery` (
  `claim_id` BIGINT UNSIGNED NOT NULL,
  `account_id` INT UNSIGNED NOT NULL,
  `guid` INT UNSIGNED NOT NULL,
  `mail_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`claim_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `account_friend` (
  `account` int unsigned NOT NULL,
  `friend_account` int unsigned NOT NULL,
  `original_guid` int unsigned NOT NULL,
  `original_name` varchar(48) NOT NULL,
  `note` varchar(48) NOT NULL DEFAULT '',
  PRIMARY KEY (`account`, `friend_account`),
  KEY `friend_account` (`friend_account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_friend_migration` (
  `account` int unsigned NOT NULL,
  PRIMARY KEY (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recovery_item_snapshot` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_guid` INT UNSIGNED NOT NULL,
  `original_guid` INT UNSIGNED NOT NULL,
  `source` TINYINT UNSIGNED NOT NULL,
  `item_entry` INT UNSIGNED NOT NULL,
  `item_count` INT UNSIGNED NOT NULL,
  `price` INT UNSIGNED NOT NULL,
  `created_at` INT UNSIGNED NOT NULL,
  `item_values` TEXT NOT NULL,
  `item_text` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `owner_id` (`owner_guid`, `id`),
  KEY `owner_source_id` (`owner_guid`, `source`, `id`),
  KEY `owner_original_source` (`owner_guid`, `original_guid`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `recovery_item_snapshot_receipt` (
  `recovery_id` BIGINT UNSIGNED NOT NULL,
  `owner_guid` INT UNSIGNED NOT NULL,
  `mail_id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`recovery_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `account_bazaar_token_reserve` (
  `account` int unsigned NOT NULL,
  `reserve` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recovery_worldforged_receipt` (
  `offer_id` INT UNSIGNED NOT NULL,
  `item_guid` INT UNSIGNED NOT NULL,
  `owner_guid` INT UNSIGNED NOT NULL,
  `mail_id` INT UNSIGNED NOT NULL,
  `required_item` INT UNSIGNED NOT NULL,
  `refunded_item` INT UNSIGNED NOT NULL,
  `rune_count` INT UNSIGNED NOT NULL,
  `claimed_at` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`offer_id`, `item_guid`),
  KEY `owner_guid` (`owner_guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `character_callboard_contract` (
  `guid` int unsigned NOT NULL,
  `contract_type` varchar(64) NOT NULL,
  `week_start` int unsigned NOT NULL,
  `completions` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`guid`, `contract_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `account_bazaar_token_hourly_cap` (
  `account` int unsigned NOT NULL,
  `window_start` int unsigned NOT NULL DEFAULT 0,
  `earned` int unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`account`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
