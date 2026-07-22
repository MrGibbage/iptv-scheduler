CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider_id` integer NOT NULL,
	`channel_id` text NOT NULL,
	`name` text NOT NULL,
	`genre` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channels_provider_channel_idx` ON `channels` (`provider_id`,`channel_id`);