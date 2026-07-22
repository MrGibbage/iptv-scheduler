ALTER TABLE `channels` RENAME COLUMN "genre" TO "category";--> statement-breakpoint
ALTER TABLE `epg_programs` RENAME COLUMN "genre" TO "category";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`provider_id` integer,
	`series_title` text,
	`keywords` text,
	`keyword_match_mode` text DEFAULT 'any' NOT NULL,
	`categories` text,
	`channel_ids` text,
	`exclude_keywords` text,
	`exclude_reruns` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "rules_has_positive_filter" CHECK("__new_rules"."series_title" IS NOT NULL OR "__new_rules"."keywords" IS NOT NULL OR "__new_rules"."categories" IS NOT NULL OR "__new_rules"."channel_ids" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_rules`("id", "name", "provider_id", "series_title", "keywords", "keyword_match_mode", "categories", "channel_ids", "exclude_keywords", "exclude_reruns", "priority", "enabled", "created_at", "updated_at") SELECT "id", "name", "provider_id", "series_title", "keywords", "keyword_match_mode", "genres", "channel_ids", "exclude_keywords", "exclude_reruns", "priority", "enabled", "created_at", "updated_at" FROM `rules`;--> statement-breakpoint
DROP TABLE `rules`;--> statement-breakpoint
ALTER TABLE `__new_rules` RENAME TO `rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;