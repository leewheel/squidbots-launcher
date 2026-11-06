# By leewheel 2026年11月6日 启动器自带建表脚本（pending_db_world，只含 CREATE TABLE IF NOT EXISTS，可重复执行）。
# 用途：核心的数据库自动更新被关闭（Updates.EnableDatabases = 0），新版本新增的表由启动器兜底创建，
# 否则世界服在 mysql_stmt_prepare 阶段会报 “Table ... doesn't exist” 并退出。
# End By leewheel
SET NAMES utf8mb4;
CREATE TABLE IF NOT EXISTS `ascension_custom_class_spell` (
    `class` TINYINT UNSIGNED NOT NULL,
    `entry_id` INT UNSIGNED NOT NULL,
    `spell_id` INT UNSIGNED NOT NULL,
    `required_level` TINYINT UNSIGNED NOT NULL,
    `flags` INT UNSIGNED NOT NULL DEFAULT 0,
    `name` VARCHAR(96) NOT NULL,
    PRIMARY KEY (`class`, `entry_id`),
    KEY `idx_ascension_custom_class_spell_level` (`class`, `required_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `charsections_dbc` (
  `Id` INT NOT NULL DEFAULT '0',
  `Race` INT NOT NULL DEFAULT '0',
  `Gender` INT NOT NULL DEFAULT '0',
  `GenType` INT NOT NULL DEFAULT '0',
  `TexturePath1` VARCHAR(100) DEFAULT NULL,
  `TexturePath2` VARCHAR(100) DEFAULT NULL,
  `TexturePath3` VARCHAR(100) DEFAULT NULL,
  `Flags` INT NOT NULL DEFAULT '0',
  `Type` INT NOT NULL DEFAULT '0',
  `Color` INT NOT NULL DEFAULT '0',
  PRIMARY KEY (`Id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `emotetextsound_dbc` (
  `Id` INT NOT NULL DEFAULT '0',
  `EmotesTextId` INT NOT NULL DEFAULT '0',
  `RaceId` INT NOT NULL DEFAULT '0',
  `SexId` INT NOT NULL DEFAULT '0',
  `SoundId` INT NOT NULL DEFAULT '0',
  PRIMARY KEY (`Id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `coa_lfg_teleport_suggestion` (
    `dungeon_id` INT UNSIGNED NOT NULL,
    `account_id` INT UNSIGNED NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `map_id` SMALLINT UNSIGNED NOT NULL,
    `position_x` FLOAT NOT NULL,
    `position_y` FLOAT NOT NULL,
    `position_z` FLOAT NOT NULL,
    `orientation` FLOAT NOT NULL,
    `player` VARCHAR(12) NOT NULL,
    `created` DATETIME NOT NULL,
    PRIMARY KEY (`dungeon_id`, `account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_client_skill_line_ability` (
  `ID` INT UNSIGNED NOT NULL,
  `SkillLine` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_client_vanity_collection` (
  `ItemID` INT UNSIGNED NOT NULL,
  `DonationPointCost` INT UNSIGNED NOT NULL DEFAULT 0,
  `SeasonalPointCost` INT UNSIGNED NOT NULL DEFAULT 0,
  `BazaarTokenCost` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`ItemID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `recruit_rewards` (
  `reward_id` INT UNSIGNED NOT NULL,
  `required_recruits` INT UNSIGNED NOT NULL,
  `realm_mode_mask` TINYINT UNSIGNED NOT NULL DEFAULT 15 COMMENT '1=CoA, 2=Freepick, 4=Warcraft Reborn, 8=Wildcard; combine bits',
  `item_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `enabled` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`reward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `creature_display_preset` (
  `entry` INT UNSIGNED NOT NULL,
  `display_id` INT UNSIGNED NOT NULL,
  `race` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `gender` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `class` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `skin` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `face` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `hair` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `haircolor` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `facialhair` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `guild_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_head` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_shoulders` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_body` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_chest` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_waist` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_legs` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_feet` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_wrists` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_hands` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_back` INT UNSIGNED NOT NULL DEFAULT 0,
  `item_tabard` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`entry`, `display_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `coa_dungeon_loot_variant` (
  `base_item` INT UNSIGNED NOT NULL,
  `heroic_item` INT UNSIGNED NOT NULL DEFAULT 0,
  `mythic_item` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`base_item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_dungeon_health` (
    `map_id` SMALLINT UNSIGNED NOT NULL,
    `difficulty` TINYINT UNSIGNED NOT NULL,
    `creature_entry` INT UNSIGNED NOT NULL,
    `max_health` INT UNSIGNED NOT NULL,
    `evidence` VARCHAR(16) NOT NULL,
    `source` VARCHAR(255) NOT NULL,
    PRIMARY KEY (`map_id`, `difficulty`, `creature_entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_dungeon_spell_damage` (
  `spell_id` int unsigned NOT NULL,
  `multiplier` float NOT NULL DEFAULT 1,
  `comment` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`spell_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_spell_damage_info` (
  `spell_id` INT UNSIGNED NOT NULL,
  `info_d0`  INT UNSIGNED NOT NULL,
  `info_d1`  INT UNSIGNED NOT NULL,
  `info_d2`  INT UNSIGNED NOT NULL,
  `info_d3`  INT UNSIGNED NOT NULL,
  `comment`  VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`spell_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `custom_emote_marks` (
  `guid` int NOT NULL,
  `src_guid` int NOT NULL,
  `entry` int NOT NULL,
  `name` varchar(100) NOT NULL DEFAULT '',
  `emote` int NOT NULL DEFAULT 0,
  `stand_state` int NOT NULL DEFAULT 0,
  `mode` enum('custom','imported','attached') NOT NULL,
  `source` varchar(96) NOT NULL DEFAULT '',
  `marked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`guid`),
  KEY `idx_entry` (`entry`),
  KEY `idx_mode` (`mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_dungeon_boss_kit` (
  `entry` int unsigned NOT NULL, `id` int unsigned NOT NULL, `spell` int unsigned NOT NULL,
  `event` tinyint unsigned NOT NULL DEFAULT 0, `difficulty` tinyint unsigned NOT NULL DEFAULT 0,
  `initial_min` int unsigned NOT NULL DEFAULT 0, `initial_max` int unsigned NOT NULL DEFAULT 0,
  `repeat_min` int unsigned NOT NULL DEFAULT 0, `repeat_max` int unsigned NOT NULL DEFAULT 0,
  `health_pct` tinyint unsigned NOT NULL DEFAULT 0, `target` tinyint unsigned NOT NULL DEFAULT 2,
  `cast_flags` tinyint unsigned NOT NULL DEFAULT 0, `base_points` int NOT NULL DEFAULT 0,
  `comment` varchar(255) NOT NULL DEFAULT '', PRIMARY KEY (`entry`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_mc_token_loot` (
    `creature_entry` INT UNSIGNED NOT NULL,
    `reference_id` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`creature_entry`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `coa_mc_fire_lord_cache_pool` (
    `RaidDifficulty` TINYINT UNSIGNED NOT NULL,
    `ItemEntry` INT UNSIGNED NOT NULL,
    PRIMARY KEY (`RaidDifficulty`, `ItemEntry`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `coa_mc_item_count` (
  `MinPlayers` TINYINT UNSIGNED NOT NULL,
  `ItemCount` TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (`MinPlayers`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Molten Core: random item count per flex player-count band';

CREATE TABLE IF NOT EXISTS `coa_mc_item_pool` (
  `RaidDifficulty` TINYINT UNSIGNED NOT NULL,
  `CreatureEntry` INT UNSIGNED NOT NULL COMMENT '0 = common pool, shared by every boss',
  `ItemEntry` INT UNSIGNED NOT NULL,
  `Weight` FLOAT NOT NULL DEFAULT 1,
  PRIMARY KEY (`RaidDifficulty`, `CreatureEntry`, `ItemEntry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Molten Core: random item pool per boss (base entry) and difficulty, 0 = common pool';

CREATE TABLE IF NOT EXISTS `coa_client_spell_description` (
  `ID` INT UNSIGNED NOT NULL,
  `Description` TEXT NOT NULL,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_dungeon_bosses` (`entry` int unsigned NOT NULL, PRIMARY KEY (`entry`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_client_super_track` (
  `ID` INT UNSIGNED NOT NULL,
  `MapID` INT UNSIGNED NOT NULL DEFAULT 0,
  `PositionX` FLOAT NOT NULL DEFAULT 0,
  `PositionY` FLOAT NOT NULL DEFAULT 0,
  `PositionZ` FLOAT NOT NULL DEFAULT 0,
  `Radius` FLOAT NOT NULL DEFAULT 0,
  `NextID` INT UNSIGNED NOT NULL DEFAULT 0,
  `Flags` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_client_shapeshift_form` (
  `ID` INT UNSIGNED NOT NULL,
  `BonusActionBar` INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_crows_cache_rewards` (
    `kind` TINYINT UNSIGNED NOT NULL,
    `item` INT UNSIGNED NOT NULL,
    `count` INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (`kind`, `item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_mythic_forces` (
    `entry`   INT UNSIGNED NOT NULL,
    `forces`  INT UNSIGNED NOT NULL DEFAULT 1,
    `comment` VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_mythic_reward` (
    `level_min` INT UNSIGNED NOT NULL,
    `level_max` INT UNSIGNED NOT NULL,
    `item`      INT UNSIGNED NOT NULL,
    `count`     INT UNSIGNED NOT NULL DEFAULT 1,
    `comment`   VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`level_min`, `level_max`, `item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_mythic_champion_path` (
    `id`  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `map` SMALLINT UNSIGNED NOT NULL,
    `a_x` FLOAT NOT NULL,
    `a_y` FLOAT NOT NULL,
    `a_z` FLOAT NOT NULL,
    `a_o` FLOAT NOT NULL DEFAULT 0,
    `b_x` FLOAT NOT NULL,
    `b_y` FLOAT NOT NULL,
    `b_z` FLOAT NOT NULL,
    `comment` VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`id`),
    KEY `map` (`map`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_dungeon_creature_damage` (
    `entry`      INT UNSIGNED NOT NULL,
    `multiplier` FLOAT NOT NULL DEFAULT 1,
    `comment`    VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_dungeon_creature_heal` (
    `entry`    INT UNSIGNED NOT NULL,
    `heal_pct` FLOAT NOT NULL DEFAULT 0,
    `comment`  VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `xp_hotspot_location` (`id` INT UNSIGNED NOT NULL, `payload` MEDIUMTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `xp_hotspot_setting` (`id` INT UNSIGNED NOT NULL, `value` INT UNSIGNED NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `coa_test_zone_bonus` (
    `zone_id` INT UNSIGNED NOT NULL,
    `experience_percent` INT UNSIGNED NOT NULL DEFAULT 200,
    `rune_percent` INT UNSIGNED NOT NULL DEFAULT 200,
    `bazaar_token_percent` INT UNSIGNED NOT NULL DEFAULT 200,
    `expires_at` INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (`zone_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_dungeon_normal_spell_damage` (
  `spell_id` int unsigned NOT NULL,
  `normal_spell_id` int unsigned NOT NULL DEFAULT 0,
  `high` float NOT NULL DEFAULT 1,
  `comment` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`spell_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_dungeon_mark_bosses` (
  `entry` int unsigned NOT NULL,
  PRIMARY KEY (`entry`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `gameobject_scale` (
  `guid` INT UNSIGNED NOT NULL,
  `scale` FLOAT NOT NULL DEFAULT 1,
  PRIMARY KEY (`guid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_client_quest_super_track` (
  `ID` INT UNSIGNED NOT NULL,
  `QuestID` INT UNSIGNED NOT NULL,
  `ObjectiveIndex` TINYINT NOT NULL COMMENT '0-3 objective, -1 completion',
  `NodeIndex` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-19',
  `SuperTrackID` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`ID`, `ObjectiveIndex`, `NodeIndex`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `coa_name_filter` (
  `term` VARCHAR(64) NOT NULL,
  `comment` VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`term`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `manastorm_Endgame_scaling_curve` (
  `depth` INT UNSIGNED NOT NULL,
  `health_multiplier` FLOAT NOT NULL DEFAULT 1,
  `global_damage_multiplier` FLOAT NOT NULL DEFAULT 1,
  `melee_multiplier` FLOAT NOT NULL DEFAULT 1,
  `spell_multiplier` FLOAT NOT NULL DEFAULT 1,
  PRIMARY KEY (`depth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `manastorm_Endgame_group_scaling` (
  `min_members` TINYINT UNSIGNED NOT NULL,
  `max_members` TINYINT UNSIGNED NOT NULL,
  `health_multiplier` FLOAT NOT NULL DEFAULT 1,
  `global_damage_multiplier` FLOAT NOT NULL DEFAULT 1,
  `melee_multiplier` FLOAT NOT NULL DEFAULT 1,
  `spell_multiplier` FLOAT NOT NULL DEFAULT 1,
  `enabled` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`min_members`, `max_members`),
  KEY `idx_endgame_group_scaling_enabled` (`enabled`, `min_members`, `max_members`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ascension_void_portal_group` (
  `groupId` int unsigned NOT NULL,
  `comment` varchar(255) NOT NULL DEFAULT '',
  PRIMARY KEY (`groupId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `ascension_quest_marker_style` (
  `CreatureEntry` INT UNSIGNED NOT NULL,
  `QuestId` INT UNSIGNED NOT NULL DEFAULT 0,
  `Style` TINYINT UNSIGNED NOT NULL,
  `Priority` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`CreatureEntry`, `QuestId`),
  CONSTRAINT `chk_ascension_quest_marker_style` CHECK (`Style` BETWEEN 1 AND 6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ascension_npc_overhead_icons` (
  `creature_entry` int unsigned NOT NULL,
  `spell_id` int unsigned NOT NULL,
  `enabled` tinyint unsigned NOT NULL DEFAULT 1,
  PRIMARY KEY (`creature_entry`),
  CONSTRAINT `chk_ascension_npc_overhead_icons_enabled` CHECK (`enabled` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `recruit_milestone_rewards` (
  `reward_id` INT UNSIGNED NOT NULL,
  `required_level` TINYINT UNSIGNED NOT NULL,
  `realm_mode_mask` TINYINT UNSIGNED NOT NULL DEFAULT 15,
  `item_id` INT UNSIGNED NOT NULL,
  `quantity` INT UNSIGNED NOT NULL DEFAULT 1,
  `enabled` TINYINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (`reward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `recovery_worldforged_offer` (
  `id` INT UNSIGNED NOT NULL,
  `required_item` INT UNSIGNED NOT NULL,
  `refunded_item` INT UNSIGNED NOT NULL,
  `rune_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `starts_at` INT UNSIGNED NOT NULL,
  `ends_at` INT UNSIGNED NOT NULL,
  `enabled` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `spellvisualkit_dbc` (
  `f0` int NOT NULL DEFAULT 0,
  `f1` int NOT NULL DEFAULT 0,
  `f2` int NOT NULL DEFAULT 0,
  `f3` int NOT NULL DEFAULT 0,
  `f4` int NOT NULL DEFAULT 0,
  `f5` int NOT NULL DEFAULT 0,
  `f6` int NOT NULL DEFAULT 0,
  `f7` int NOT NULL DEFAULT 0,
  `f8` int NOT NULL DEFAULT 0,
  `f9` int NOT NULL DEFAULT 0,
  `f10` int NOT NULL DEFAULT 0,
  `f11` int NOT NULL DEFAULT 0,
  `f12` int NOT NULL DEFAULT 0,
  `f13` int NOT NULL DEFAULT 0,
  `f14` int NOT NULL DEFAULT 0,
  `f15` int NOT NULL DEFAULT 0,
  `f16` int NOT NULL DEFAULT 0,
  `f17` int NOT NULL DEFAULT 0,
  `f18` int NOT NULL DEFAULT 0,
  `f19` int NOT NULL DEFAULT 0,
  `f20` int NOT NULL DEFAULT 0,
  `f21` int NOT NULL DEFAULT 0,
  `f22` int NOT NULL DEFAULT 0,
  `f23` int NOT NULL DEFAULT 0,
  `f24` int NOT NULL DEFAULT 0,
  `f25` int NOT NULL DEFAULT 0,
  `f26` int NOT NULL DEFAULT 0,
  `f27` int NOT NULL DEFAULT 0,
  `f28` int NOT NULL DEFAULT 0,
  `f29` int NOT NULL DEFAULT 0,
  `f30` int NOT NULL DEFAULT 0,
  `f31` int NOT NULL DEFAULT 0,
  `f32` int NOT NULL DEFAULT 0,
  `f33` int NOT NULL DEFAULT 0,
  `f34` int NOT NULL DEFAULT 0,
  `f35` int NOT NULL DEFAULT 0,
  `f36` int NOT NULL DEFAULT 0,
  `f37` int NOT NULL DEFAULT 0
  , PRIMARY KEY (`f0`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `spellvisualkitmodelattach_dbc` (
  `ID` int NOT NULL DEFAULT 0,
  `ParentSpellVisualKitID` int NOT NULL DEFAULT 0,
  `SpellVisualEffectNameID` int NOT NULL DEFAULT 0,
  `AttachmentID` int NOT NULL DEFAULT 0,
  `OffsetX` float NOT NULL DEFAULT 0,
  `OffsetY` float NOT NULL DEFAULT 0,
  `OffsetZ` float NOT NULL DEFAULT 0,
  `Yaw` float NOT NULL DEFAULT 0,
  `Pitch` float NOT NULL DEFAULT 0,
  `Roll` float NOT NULL DEFAULT 0,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `spellvisualeffectname_dbc` (
  `ID` int NOT NULL DEFAULT 0,
  `Name` varchar(255) NOT NULL DEFAULT '',
  `FilePath` varchar(255) NOT NULL DEFAULT '',
  `Scale` float NOT NULL DEFAULT 0,
  `Scale2` float NOT NULL DEFAULT 0,
  `MinScale` float NOT NULL DEFAULT 0,
  `MaxScale` float NOT NULL DEFAULT 0,
  PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ascension_callboard_contract` (
  `QuestId` int unsigned NOT NULL,
  `ContractType` varchar(64) NOT NULL,
  `ContentType` varchar(16) NOT NULL,
  PRIMARY KEY (`QuestId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coa_cosmetic_pet_appearance` (
    `appearance_id` INT UNSIGNED NOT NULL,
    `token_item` INT UNSIGNED NOT NULL,
    `creature_entry` INT UNSIGNED NOT NULL,
    `category_id` TINYINT UNSIGNED NOT NULL,
    `preview_creature` INT UNSIGNED NOT NULL DEFAULT 0,
    `live` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `seasonal` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `league` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `ptr` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `development` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (`appearance_id`),
    UNIQUE KEY `token_item` (`token_item`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ascension_class_stats` (
  `Class` tinyint unsigned NOT NULL,
  `Level` tinyint unsigned NOT NULL,
  `BaseHP` int unsigned NOT NULL DEFAULT '1',
  `BaseMana` int unsigned NOT NULL DEFAULT '1',
  `Strength` int unsigned NOT NULL DEFAULT '0',
  `Agility` int unsigned NOT NULL DEFAULT '0',
  `Stamina` int unsigned NOT NULL DEFAULT '0',
  `Intellect` int unsigned NOT NULL DEFAULT '0',
  `Spirit` int unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`Class`, `Level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Ascension class level stats used instead of player_class_stats while CoA.ClassLevelSixtyStats.Enable is 1.';

CREATE TABLE IF NOT EXISTS `ascension_race_class_stats` (
  `Race` tinyint unsigned NOT NULL,
  `Class` tinyint unsigned NOT NULL,
  `Level` tinyint unsigned NOT NULL,
  `Strength` smallint NOT NULL DEFAULT 0,
  `Agility` smallint NOT NULL DEFAULT 0,
  `Stamina` smallint NOT NULL DEFAULT 0,
  `Intellect` smallint NOT NULL DEFAULT 0,
  `Spirit` smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (`Race`, `Class`, `Level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Per race and class stat adjustment added to player_class_stats plus player_race_stats.';
