PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`recorder_recording_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "scheduled_recordings_end_after_start" CHECK("__new_scheduled_recordings"."end_time" > "__new_scheduled_recordings"."start_time")
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_recordings`("id", "rule_id", "provider_id", "channel_id", "title", "start_time", "end_time", "recorder_recording_id", "created_at") SELECT "id", "rule_id", "provider_id", "channel_id", "title", "start_time", "end_time", "recorder_recording_id", "created_at" FROM `scheduled_recordings`;--> statement-breakpoint
DROP TABLE `scheduled_recordings`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_recordings` RENAME TO `scheduled_recordings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_recordings_provider_channel_start_idx` ON `scheduled_recordings` (`provider_id`,`channel_id`,`start_time`);