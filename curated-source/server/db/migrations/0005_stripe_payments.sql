ALTER TABLE `galleries` ADD `stripe_account_id` text;--> statement-breakpoint
ALTER TABLE `galleries` ADD `stripe_payouts_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_expires_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_charge_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_transfer_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_refund_id` text;