CREATE TABLE `execution_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`automatic_scheduling_enabled` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scheduled_recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`title` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`recorder_recording_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `rules`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduled_recordings_end_after_start" CHECK("scheduled_recordings"."end_time" > "scheduled_recordings"."start_time")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_recordings_provider_channel_start_idx` ON `scheduled_recordings` (`provider_id`,`channel_id`,`start_time`);