CREATE TABLE `epg_programs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`genre` text,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`original_air_date` integer,
	`fetched_at` integer NOT NULL,
	CONSTRAINT "epg_programs_end_after_start" CHECK("epg_programs"."end_time" > "epg_programs"."start_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `epg_programs_provider_channel_start_idx` ON `epg_programs` (`provider_id`,`channel_id`,`start_time`);--> statement-breakpoint
CREATE TABLE `recorder_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_url` text,
	`api_key_encrypted` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`provider_id` integer,
	`series_title` text,
	`keywords` text,
	`keyword_match_mode` text DEFAULT 'any' NOT NULL,
	`genres` text,
	`channel_ids` text,
	`exclude_keywords` text,
	`exclude_reruns` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "rules_has_positive_filter" CHECK("rules"."series_title" IS NOT NULL OR "rules"."keywords" IS NOT NULL OR "rules"."genres" IS NOT NULL OR "rules"."channel_ids" IS NOT NULL)
);
