-- Marketing Agent: weekly campaign automation tables

-- Agent week status enum
DO $$ BEGIN
  CREATE TYPE "public"."agent_week_status" AS ENUM(
    'planning', 'ideas_selected', 'generating', 'generated',
    'reviewing', 'approved', 'scheduling', 'scheduled', 'sent', 'error'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Agent weeks table
CREATE TABLE IF NOT EXISTS "agent_weeks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" text NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
  "week_of" date NOT NULL,
  "status" "agent_week_status" DEFAULT 'planning' NOT NULL,
  "send_count" integer DEFAULT 2 NOT NULL,
  "error_message" text,
  "selection_metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_weeks_brand_week_unique"
  ON "agent_weeks" ("brand_id", "week_of");
CREATE INDEX IF NOT EXISTS "agent_weeks_brand_idx"
  ON "agent_weeks" ("brand_id");
CREATE INDEX IF NOT EXISTS "agent_weeks_status_idx"
  ON "agent_weeks" ("status");

-- Content calendar entry versions table (A/B comparison)
CREATE TABLE IF NOT EXISTS "content_calendar_entry_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "entry_id" uuid NOT NULL REFERENCES "content_calendar_entries"("id") ON DELETE CASCADE,
  "chat_id" text REFERENCES "chat"("id") ON DELETE SET NULL,
  "version_label" text DEFAULT 'A' NOT NULL,
  "creative_angle" text,
  "critique_score" integer,
  "is_selected" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "entry_versions_entry_label_unique"
  ON "content_calendar_entry_versions" ("entry_id", "version_label");
CREATE INDEX IF NOT EXISTS "entry_versions_entry_idx"
  ON "content_calendar_entry_versions" ("entry_id");
CREATE INDEX IF NOT EXISTS "entry_versions_chat_idx"
  ON "content_calendar_entry_versions" ("chat_id");

-- Add agent_week_id and is_selected_for_send to content_calendar_entries
ALTER TABLE "content_calendar_entries"
  ADD COLUMN IF NOT EXISTS "agent_week_id" uuid
  REFERENCES "agent_weeks"("id") ON DELETE SET NULL;

ALTER TABLE "content_calendar_entries"
  ADD COLUMN IF NOT EXISTS "is_selected_for_send" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "content_calendar_entries_agent_week_idx"
  ON "content_calendar_entries" ("agent_week_id");
