-- Add Slack notification settings to Flows after merging Slack notification support from Autopilot.

-- AlterTable
ALTER TABLE "flows" ADD COLUMN "slack_notification_config" JSONB;
