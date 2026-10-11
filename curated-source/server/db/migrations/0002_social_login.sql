ALTER TABLE `users` ADD `google_sub` text;--> statement-breakpoint
ALTER TABLE `users` ADD `facebook_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `password_set` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_facebook_id_unique` ON `users` (`facebook_id`);