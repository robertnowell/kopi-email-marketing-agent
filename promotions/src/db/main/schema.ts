import { Brand } from "@/features/editor";
import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  pgTable,
  varchar,
  timestamp,
  json,
  uuid,
  text,
  integer,
  primaryKey,
  pgSequence,
  pgEnum,
  index,
  jsonb,
  vector,
  unique,
} from "drizzle-orm/pg-core";

// Users table for authentication (if needed in future)
export const user = pgTable("user", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = InferSelectModel<typeof user>;

// Chat table - replaces the concept of "pages"
export const chat = pgTable("chat", {
  id: text("id").primaryKey().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  title: text("title").notNull(),
  userId: text("user_id"), // Firebase user ID (TEXT, not UUID)
  visibility: varchar("visibility", { enum: ["public", "private"] })
    .notNull()
    .default("private"),
  brandId: text("brand_id").references(() => brands.id, {
    onDelete: "cascade", // If brand is deleted, cascade delete the chat
  }),
  metadata: json("metadata"), // Flexible field for page-level metadata
});

export type Chat = InferSelectModel<typeof chat>;

// Message table - stores individual interactions/generations
export const message = pgTable("message", {
  id: text("id").primaryKey().notNull(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 255 }).notNull(),
  parts: json("parts").notNull(), // Core content: text, prompt
  attachments: json("attachments").notNull(), // File attachments
  metadata: json("metadata"), // Flexible field for additional properties
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Message = InferSelectModel<typeof message>;
export type DBMessage = typeof message.$inferInsert;

// Vote table - for thumbs up/down on messages
export const vote = pgTable(
  "vote",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    isUpvoted: boolean("is_upvoted").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] }),
  })
);

export type Vote = InferSelectModel<typeof vote>;

// Stream table - for managing streaming responses
export const stream = pgTable("stream", {
  id: text("id").primaryKey().notNull(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chat.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Stream = InferSelectModel<typeof stream>;

// Message Artifact table - stores the AI-generated content (both raw XML and parsed JSON)
export const messageArtifact = pgTable("message_artifact", {
  id: text("id").primaryKey().notNull(),
  messageId: text("message_id")
    .notNull()
    .unique()
    .references(() => message.id, { onDelete: "cascade" }),
  raw: text("raw").notNull(), // Raw AI output (XML)
  parsed: text("parsed").notNull(), // Parsed content (JSON)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type MessageArtifact = InferSelectModel<typeof messageArtifact>;

// Type for brand data stored in JSON column
type ThemeData = Omit<Brand, "id" | "crawlMarkdown">;

// PostgreSQL Themes Table (Experimental)
// This is modular and behind a feature flag, completely independent from existing code
export const brands = pgTable("brands", {
  id: text("id").primaryKey().notNull(),
  user_id: text("user_id"), // TEMPORARY: Keep for backwards compatibility during migration
  data: json("data").$type<ThemeData>().notNull(), // All brand data except crawl_markdown
  crawl_markdown: text("crawl_markdown"), // Large markdown field (will be compressed by TOAST if >2KB)
  crawl_url: text("crawl_url"), // Store URL separately for easy querying
  is_private: boolean("is_private").notNull().default(false), // Private brands have their emails hidden from public directory
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PostgresTheme = InferSelectModel<typeof brands>;

// Brand membership roles
export const memberRoleEnum = pgEnum("member_role", ["admin", "member"]);

// Brand membership table - allows multiple users per brand
export const brandMembership = pgTable(
  "brand_membership",
  {
    id: uuid("id").notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Firebase user ID
    role: memberRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at").notNull().defaultNow(),
    invitedBy: text("invited_by"), // Firebase user ID of who invited them
  },
  (table) => [
    // Composite primary key on brandId and userId
    primaryKey({
      columns: [table.brandId, table.userId],
      name: "brand_membership_pk",
    }),
  ]
);

export type BrandMembership = InferSelectModel<typeof brandMembership>;

// Invitation status enum
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "rejected",
  "expired",
]);

// Brand invitations table
export const brandInvitation = pgTable("brand_invitation", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  code: text("code").notNull().unique(), // Random invitation code
  brandId: text("brand_id")
    .notNull()
    .references(() => brands.id, { onDelete: "cascade" }),
  invitedBy: text("invited_by").notNull(), // Firebase user ID who created the invitation
  invitedEmail: text("invited_email"), // Optional: specific email being invited
  role: memberRoleEnum("role").notNull().default("member"),
  status: invitationStatusEnum("status").notNull().default("pending"),
  maxUses: integer("max_uses").default(1), // How many times can this invitation be used
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"), // Optional expiration date
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at"),
  acceptedBy: text("accepted_by"), // Firebase user ID who accepted
});

export type BrandInvitation = InferSelectModel<typeof brandInvitation>;

// Asset generation tables
export const assetSession = pgTable("asset_session", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull(), // Firebase user ID
  brandId: text("brand_id").references(() => brands.id, {
    onDelete: "set null", // Keep session if brand is deleted
  }),
  initialPrompt: text("initial_prompt"),
  orientation: varchar("orientation", {
    enum: ["square", "portrait", "landscape"],
  })
    .notNull()
    .default("portrait"),
  quality: varchar("quality", { enum: ["speed", "quality"] })
    .notNull()
    .default("speed"),
  referenceImageUrl: text("reference_image_url"),
  referenceImageBase64: text("reference_image_base64"),
  metadata: json("metadata"), // Flexible field for session metadata
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AssetSession = InferSelectModel<typeof assetSession>;

export const assetGeneration = pgTable("asset_generation", {
  id: text("id").primaryKey().notNull(),
  sessionId: text("session_id")
    .notNull()
    .references(() => assetSession.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  status: varchar("status", {
    enum: ["pending", "getting_brief", "generating", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  url: text("url"), // Final asset URL when completed
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  promptUsed: text("prompt_used"),
  brief: json("brief"), // AssetBrief object
  altText: text("alt_text"), // Error message or description
  orientation: varchar("orientation", {
    enum: [
      "square",
      "portrait",
      "landscape",
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4",
      "4:5",
      "5:4",
      "3:2",
      "2:3",
      "21:9",
    ],
  }),
  model: varchar("model", { length: 255 }), // Model used for generation
  addedToBrandId: text("added_to_brand_id"), // If asset was saved to a brand
  metadata: json("metadata"), // Flexible field
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AssetGeneration = InferSelectModel<typeof assetGeneration>;

/**
 * ChatGPT email drafts table - stores generated email drafts permanently.
 * Uses JSONB metadata column for future extensibility without schema changes.
 */
export const chatgptEmails = pgTable(
  "chatgpt_emails",
  {
    id: text("id").primaryKey(),
    html: text("html").notNull(),
    subject: text("subject").notNull(),
    prompt: text("prompt").notNull(),
    screenshotUrl: text("screenshot_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Flexible metadata for future fields (brandUrl, screenshotUrl, etc.) */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [index("idx_chatgpt_emails_created_at").on(table.createdAt)]
);

export type ChatGptEmail = typeof chatgptEmails.$inferSelect;
export type NewChatGptEmail = typeof chatgptEmails.$inferInsert;

/**
 * Brand Asset Embeddings table - stores vector embeddings for brand assets
 * Enables semantic search/filtering of brand assets by similarity
 * Uses text-embedding-3-small (1536 dimensions)
 */
export const brandAssetEmbeddings = pgTable(
  "brand_asset_embeddings",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    assetUrl: text("asset_url").notNull(),
    content: text("content").notNull(), // The altText used for embedding
    contentHash: text("content_hash").notNull(), // For deduplication
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    // Asset metadata for filtering/ranking in inspiration feed
    assetType: text("asset_type").notNull().default("brand"), // 'brand' | 'generated' | 'inspiration'
    isLogo: boolean("is_logo").notNull().default(false),
    // FK to brand_assets table (nullable for backwards compatibility during migration)
    brandAssetId: uuid("brand_asset_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Composite unique constraint on brand_id + asset_url
    unique("brand_asset_embeddings_brand_url_unique").on(
      table.brandId,
      table.assetUrl
    ),
    // Index for filtering by brand_id
    index("brand_asset_embeddings_brand_id_idx").on(table.brandId),
    // HNSW index for fast vector similarity search
    index("brand_asset_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
    // Index for filtering by asset type and logo status
    index("brand_asset_embeddings_type_logo_idx").on(
      table.assetType,
      table.isLogo
    ),
    // Index for the brand_asset_id FK
    index("brand_asset_embeddings_asset_id_idx").on(table.brandAssetId),
  ]
);

export type BrandAssetEmbedding = InferSelectModel<typeof brandAssetEmbeddings>;
export type NewBrandAssetEmbedding = typeof brandAssetEmbeddings.$inferInsert;

/**
 * Brand Embedding Chunks table - stores vector embeddings for brand-level semantic search
 * Supports single 'summary' chunk in v0, faceted chunks (audience, values, tone, visual_style) in v0.5+
 * Uses text-embedding-3-small (1536 dimensions)
 */
export const brandEmbeddingChunks = pgTable(
  "brand_embedding_chunks",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    chunkType: text("chunk_type").notNull(), // v0: 'summary', v0.5+: 'audience', 'values', 'tone', 'visual_style'
    content: text("content").notNull(), // The text that was embedded
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Composite unique constraint on brand_id + chunk_type
    unique("brand_embedding_chunks_brand_type_unique").on(
      table.brandId,
      table.chunkType
    ),
    // Index for filtering by brand_id
    index("brand_embedding_chunks_brand_idx").on(table.brandId),
    // HNSW index for fast vector similarity search
    index("brand_embedding_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export type BrandEmbeddingChunk = InferSelectModel<typeof brandEmbeddingChunks>;
export type NewBrandEmbeddingChunk = typeof brandEmbeddingChunks.$inferInsert;

/**
 * Email Reviews table - stores AI-powered email analysis results
 * Used for the /review and /email-reviews SEO pages
 */
export const emailReviews = pgTable(
  "email_reviews",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    publicId: text("public_id").notNull().unique(), // Short ID for URLs
    userId: text("user_id"), // Firebase user ID (optional for anonymous reviews)
    brandName: text("brand_name"), // Extracted or user-provided brand name
    screenshotUrl: text("screenshot_url"), // Uploaded email screenshot
    analysisResult: json("analysis_result"), // Full EmailAnalysis object
    overallScore: integer("overall_score"), // 0-100 score for sorting
    overallGrade: text("overall_grade"), // A/B/C/D/NI letter grade
    isPrivate: boolean("is_private").notNull().default(false), // Private reviews hidden from directory
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("email_reviews_created_at_idx").on(table.createdAt),
    index("email_reviews_overall_score_idx").on(table.overallScore),
  ]
);

export type EmailReview = InferSelectModel<typeof emailReviews>;
export type NewEmailReview = typeof emailReviews.$inferInsert;

/**
 * Integration Connections table - stores OAuth/API credentials for external services
 * Generic table used by Klaviyo, Canva, Mailchimp, and future integrations
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'klaviyo', 'canva', 'mailchimp', 'figma', etc.

    // Encrypted credentials (API key for Klaviyo, OAuth tokens for Canva)
    credentialsEncrypted: text("credentials_encrypted").notNull(),

    // Provider-specific settings as JSONB
    settings: jsonb("settings").$type<Record<string, unknown>>(),

    // For inbound webhooks (Klaviyo/Mailchimp use this)
    webhookSecret: text("webhook_secret"),

    // Status tracking
    isEnabled: boolean("is_enabled").notNull().default(false),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }), // For OAuth providers
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),

    // Health tracking for circuit breaker / alerting
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastErrorMessage: text("last_error_message"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("integration_connections_brand_provider").on(
      table.brandId,
      table.provider
    ),
    index("integration_connections_brand_id_idx").on(table.brandId),
  ]
);

export type IntegrationConnection = InferSelectModel<
  typeof integrationConnections
>;
export type NewIntegrationConnection =
  typeof integrationConnections.$inferInsert;

/**
 * Suppression status enum for tracking webhook event outcomes
 */
export const suppressionStatusEnum = pgEnum("suppression_status", [
  "pending",
  "success",
  "failed",
  "skipped_duplicate",
  "skipped_dry_run",
  "skipped_disabled",
]);

/**
 * Suppression Events table - logs all suppression attempts for Klaviyo/Mailchimp
 * Used for stats dashboard, idempotency checks, and debugging
 */
export const suppressionEvents = pgTable(
  "suppression_events",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    // Profile info (store hash for idempotency, masked email for UI)
    emailHash: text("email_hash").notNull(), // SHA256 of lowercase email
    emailMasked: text("email_masked"), // "j***@example.com" for UI display

    // Status and response
    status: suppressionStatusEnum("status").notNull(),
    providerResponse: jsonb("provider_response"), // Raw API response
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),

    segmentId: text("segment_id"),
    jobId: text("job_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("suppression_events_integration_id_idx").on(table.integrationId),
    index("suppression_events_brand_id_idx").on(table.brandId),
    index("suppression_events_created_at_idx").on(table.createdAt),
    index("suppression_events_email_hash_idx").on(table.emailHash),
    index("suppression_events_segment_id_idx").on(table.segmentId),
    index("suppression_events_job_id_idx").on(table.jobId),
  ]
);

export type SuppressionEvent = InferSelectModel<typeof suppressionEvents>;
export type NewSuppressionEvent = typeof suppressionEvents.$inferInsert;

/**
 * Suppression job status enum
 */
export const suppressionJobStatusEnum = pgEnum("suppression_job_status", [
  "processing",
  "complete",
  "failed",
  "cancelled",
]);

/**
 * Suppression Jobs table - one row per bulk suppress run.
 * Tracks progress via running counters updated by the background job.
 * Enables fast polling for live progress and historical job browsing.
 */
export const suppressionJobs = pgTable(
  "suppression_jobs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    jobId: text("job_id").notNull().unique(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    emailCount: integer("email_count").notNull(),
    mode: text("mode").notNull(),
    source: text("source"),
    segmentId: text("segment_id"),
    segmentName: text("segment_name"),
    status: suppressionJobStatusEnum("status").notNull().default("processing"),
    succeeded: integer("succeeded").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    errorMessage: text("error_message"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("suppression_jobs_job_id_idx").on(table.jobId),
    index("suppression_jobs_brand_id_idx").on(table.brandId),
  ]
);

export type SuppressionJob = InferSelectModel<typeof suppressionJobs>;

/**
 * Suppression audit log action enum
 */
export const suppressionAuditActionEnum = pgEnum("suppression_audit_action", [
  "triage_suppress",
  "bulk_suppress",
  "cancel",
  "webhook",
]);

/**
 * Suppression Audit Log - records WHO initiated every suppression action.
 * Critical for incident investigation and accountability.
 */
export const suppressionAuditLog = pgTable(
  "suppression_audit_log",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    action: suppressionAuditActionEnum("action").notNull(),
    emailCount: integer("email_count"),

    userId: text("user_id"),
    userEmail: text("user_email"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    requestPayload: jsonb("request_payload"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("suppression_audit_log_brand_id_idx").on(table.brandId),
    index("suppression_audit_log_created_at_idx").on(table.createdAt),
    index("suppression_audit_log_job_id_idx").on(table.jobId),
  ]
);

export type SuppressionAuditLogEntry = InferSelectModel<
  typeof suppressionAuditLog
>;

/**
 * Followed Brands table - tracks brand-to-brand follow relationships
 * Brand A follows Brand B for inspiration
 * Used by the Inspiration page to show content from followed brands
 */
export const followedBrands = pgTable(
  "followed_brands",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }), // The brand doing the following
    followedBrandId: text("followed_brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }), // The brand being followed
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unique constraint: a brand can only follow another brand once
    unique("followed_brands_brand_followed_unique").on(
      table.brandId,
      table.followedBrandId
    ),
    // Index for quick lookup by brand (get all brands a brand follows)
    index("followed_brands_brand_id_idx").on(table.brandId),
    // Index for counting followers per brand
    index("followed_brands_followed_brand_id_idx").on(table.followedBrandId),
  ]
);

export type FollowedBrand = InferSelectModel<typeof followedBrands>;
export type NewFollowedBrand = typeof followedBrands.$inferInsert;

/**
 * Brand Products table - stores Shopify product metadata
 * Used for product search in editor and linking to product images
 * Product images are stored in brand_assets with product_id FK
 */
export const brandProducts = pgTable(
  "brand_products",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(), // Shopify product ID
    handle: text("handle"),
    title: text("title").notNull(),
    description: text("description"),
    priceCents: integer("price_cents"),
    compareAtPriceCents: integer("compare_at_price_cents"),
    vendor: text("vendor"),
    productType: text("product_type"),
    tags: text("tags").array(),
    variants: jsonb("variants"), // [{id, title, price, sku}]
    thumbnailUrl: text("thumbnail_url"), // Shopify CDN URL for preview (not stored in brand_assets)
    // Text embedding for semantic product search (editor "suggest products" feature)
    // Content: title | description | tags
    embedding: vector("embedding", { dimensions: 1536 }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("brand_products_brand_external_unique").on(
      table.brandId,
      table.externalId
    ),
    index("brand_products_brand_idx").on(table.brandId),
    // HNSW index for fast vector similarity search
    index("brand_products_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export type BrandProduct = InferSelectModel<typeof brandProducts>;
export type NewBrandProduct = typeof brandProducts.$inferInsert;

/**
 * Brand Assets table - canonical source of truth for all brand assets
 * Replaces brands.data.assets JSON array with proper relational storage
 * Embeddings reference this table via brand_asset_id FK
 */
export const brandAssets = pgTable(
  "brand_assets",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    // Identity + Dedup
    url: text("url").notNull(),
    urlHash: text("url_hash").notNull(), // SHA256 of normalized URL for dedup
    contentSha256: text("content_sha256"), // SHA256 of image bytes, nullable until computed
    phash: varchar("phash", { length: 64 }), // 64-bit perceptual hash for visual dedup
    colorHistogram: json("color_histogram").$type<{
      r: number[];
      g: number[];
      b: number[];
    }>(), // RGB histogram for color-aware dedup

    // Type (two orthogonal dimensions)
    ownershipType: text("ownership_type").notNull().default("brand"), // 'brand' | 'generated' | 'inspiration'
    contentType: text("content_type").notNull().default("image"), // 'image' | 'email' | 'product'

    // Source/provenance
    source: text("source").notNull().default("upload"), // 'upload' | 'crawl' | 'products_json' | 'email' | 'generated'
    sourcePageUrl: text("source_page_url"),

    // Metadata (content-type specific)
    fileName: text("file_name"),
    altText: text("alt_text"),
    width: integer("width"),
    height: integer("height"),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
    isLogo: boolean("is_logo").notNull().default(false),
    isAnimatedGif: boolean("is_animated_gif").notNull().default(false),

    // Email-specific (nullable)
    emailId: text("email_id").references(() => chat.id, {
      onDelete: "set null",
    }),

    // Product-specific (nullable)
    productId: uuid("product_id").references(() => brandProducts.id, {
      onDelete: "set null",
    }),
    productTitle: text("product_title"),

    // Pack-specific (nullable) - for assets that are part of an asset pack
    packId: uuid("pack_id"), // FK added below to avoid circular reference

    // Generation metadata (for AI-generated assets)
    generationMetadata: json("generation_metadata").$type<{
      prompt?: string;
      referenceAssetUrls?: string[];
      generator?: string;
      model?: string;
      orientation?: string;
      createdAt?: number;
    }>(),

    // Lifecycle
    status: text("status").notNull().default("complete"), // 'pending' | 'complete' | 'error'
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("brand_assets_brand_url_hash_unique").on(
      table.brandId,
      table.urlHash
    ),
    index("brand_assets_brand_idx").on(table.brandId),
    index("brand_assets_content_type_idx").on(table.contentType),
    index("brand_assets_source_idx").on(table.source),
    index("brand_assets_captured_at_idx").on(table.capturedAt),
    // Partial unique index for content hash dedup (only when computed)
    index("brand_assets_content_sha256_idx").on(
      table.brandId,
      table.contentSha256
    ),
  ]
);

export type BrandAsset = InferSelectModel<typeof brandAssets>;
export type NewBrandAsset = typeof brandAssets.$inferInsert;

/**
 * Product Assets join table - links products to assets (many-to-many)
 * Allows same image to be shared across products and enables dedup
 */
export const productAssets = pgTable(
  "product_assets",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => brandProducts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => brandAssets.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("gallery"), // 'primary' | 'gallery'
    position: integer("position").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("product_assets_product_asset_unique").on(
      table.productId,
      table.assetId
    ),
    index("product_assets_product_idx").on(table.productId),
    index("product_assets_asset_idx").on(table.assetId),
  ]
);

export type ProductAsset = InferSelectModel<typeof productAssets>;
export type NewProductAsset = typeof productAssets.$inferInsert;

/**
 * Brand Enrichment State table - tracks async enrichment progress
 * Separate from brands table for clean separation of concerns
 */
export const brandEnrichState = pgTable(
  "brand_enrich_state",
  {
    brandId: text("brand_id")
      .primaryKey()
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    // Overall status
    status: text("status").notNull().default("pending"), // 'pending' | 'running' | 'complete' | 'error'

    // Substep tracking for UI progress indicator
    productsStatus: text("products_status").default("pending"),
    productsSyncedAt: timestamp("products_synced_at", { withTimezone: true }),
    multipageStatus: text("multipage_status").default("pending"),
    multipageCrawledAt: timestamp("multipage_crawled_at", {
      withTimezone: true,
    }),
    facetsStatus: text("facets_status").default("pending"),
    facetsGeneratedAt: timestamp("facets_generated_at", { withTimezone: true }),

    // Error tracking
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("brand_enrich_state_status_idx").on(table.status)]
);

export type BrandEnrichState = InferSelectModel<typeof brandEnrichState>;
export type NewBrandEnrichState = typeof brandEnrichState.$inferInsert;

/**
 * Asset Packs table - groups generated images of different aspect ratios
 * Created when user generates a "pack" from a source image
 */
export const assetPacks = pgTable(
  "asset_packs",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name"),
    sourceAssetId: uuid("source_asset_id").references(() => brandAssets.id, {
      onDelete: "set null",
    }),
    sourceAssetUrl: text("source_asset_url"), // Denormalized for display
    prompt: text("prompt"),
    model: text("model"),
    status: text("status").notNull().default("generating"), // 'generating' | 'complete' | 'partial' | 'error'
    targetOrientations: text("target_orientations").array().notNull(),
    completedOrientations: text("completed_orientations")
      .array()
      .notNull()
      .default([]),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("asset_packs_brand_idx").on(table.brandId),
    index("asset_packs_status_idx").on(table.status),
    index("asset_packs_created_at_idx").on(table.createdAt),
  ]
);

export type AssetPack = InferSelectModel<typeof assetPacks>;
export type NewAssetPack = typeof assetPacks.$inferInsert;

export const iconEmbeddings = pgTable(
  "icon_embeddings",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    source: text("source").notNull().default("lucide"),
    iconName: text("icon_name").notNull(),
    previewUrl: text("preview_url").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    description: text("description").notNull().default(""),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("icon_embeddings_source_name_unique").on(
      table.source,
      table.iconName
    ),
    index("icon_embeddings_source_idx").on(table.source),
    index("icon_embeddings_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  ]
);

export type IconEmbedding = InferSelectModel<typeof iconEmbeddings>;
export type NewIconEmbedding = typeof iconEmbeddings.$inferInsert;

/**
 * Brand Components table - stores both global layout templates and brand-specific saved blocks.
 * brand_id IS NULL = global template available to all brands.
 * brand_id IS NOT NULL = brand-specific saved component.
 */
export const brandComponents = pgTable(
  "brand_components",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id").references(() => brands.id, {
      onDelete: "cascade",
    }),

    name: text("name").notNull(),
    tag: text("tag").notNull(),
    description: text("description").notNull(),

    contentType: text("content_type").notNull().default("custom-html"),
    html: text("html"),
    wandScript: text("wand_script"),
    prompt: text("prompt"),

    category: text("category"),
    source: text("source").default("flodesk"),
    sourceChatId: text("source_chat_id"),
    sourceMessageId: text("source_message_id"),

    embedding: vector("embedding", { dimensions: 1536 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("brand_components_brand_idx").on(table.brandId)]
);

export type BrandComponent = InferSelectModel<typeof brandComponents>;
export type NewBrandComponent = typeof brandComponents.$inferInsert;

// ============================================================================
// Email Ideas
// ============================================================================

export const ideaCategoryEnum = pgEnum("idea_category", [
  "campaign",
  "flow_email",
]);

export const ideaStatusEnum = pgEnum("idea_status", [
  "active",
  "dismissed",
  "created",
  "expired",
]);

export const emailIdeas = pgTable(
  "email_ideas",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    // Content
    category: ideaCategoryEnum("category").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    suggestedPrompt: text("suggested_prompt").notNull(),

    // Flow context (null for campaigns)
    flowName: text("flow_name"),
    flowId: text("flow_id"),
    isMissingFlow: boolean("is_missing_flow").notNull().default(false),

    // Timeliness
    suggestedSendDate: timestamp("suggested_send_date", {
      withTimezone: true,
    }),
    relevanceReason: text("relevance_reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Status tracking
    status: ideaStatusEnum("status").notNull().default("active"),
    chatId: text("chat_id").references(() => chat.id, {
      onDelete: "set null",
    }),

    // Generation metadata
    generationBatchId: text("generation_batch_id").notNull(),
    sourceData: jsonb("source_data").$type<Record<string, unknown>>(),
    priority: integer("priority").notNull().default(0),

    // Performance context + creative brief
    recommendationType: text("recommendation_type"),
    targetMessageId: text("target_message_id"),
    targetMessageName: text("target_message_name"),
    creativeBrief: jsonb("creative_brief").$type<{
      hook?: string;
      graphic?: string;
      offer?: string;
      context?: string;
    }>(),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("email_ideas_brand_idx").on(table.brandId),
    index("email_ideas_brand_status_idx").on(table.brandId, table.status),
    index("email_ideas_batch_idx").on(table.generationBatchId),
  ]
);

export type EmailIdea = InferSelectModel<typeof emailIdeas>;
export type NewEmailIdea = typeof emailIdeas.$inferInsert;

// ============================================================================
// Content Calendar
// ============================================================================

export const contentCalendarEntryTypeEnum = pgEnum("content_calendar_entry_type", [
  "campaign",
  "flow_improvement",
]);

export const contentCalendarEntryStatusEnum = pgEnum(
  "content_calendar_entry_status",
  ["planned", "queued", "generating", "generated", "failed"]
);

export const contentCalendarTaskStatusEnum = pgEnum(
  "content_calendar_task_status",
  ["queued", "running", "completed", "failed", "cancelled"]
);

export const contentCalendarEntries = pgTable(
  "content_calendar_entries",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    sourceIdeaId: uuid("source_idea_id").references(() => emailIdeas.id, {
      onDelete: "set null",
    }),
    entryType: contentCalendarEntryTypeEnum("entry_type").notNull(),
    title: text("title").notNull(),
    ideaText: text("idea_text").notNull(),
    suggestedPrompt: text("suggested_prompt").notNull(),
    emailPlan: jsonb("email_plan").$type<Record<string, unknown>>(),
    plannedDate: timestamp("planned_date", { withTimezone: true }).notNull(),
    flowId: text("flow_id"),
    flowName: text("flow_name"),
    targetMessageId: text("target_message_id"),
    status: contentCalendarEntryStatusEnum("status").notNull().default("planned"),
    autoGenerate: boolean("auto_generate").notNull().default(true),
    generatedChatId: text("generated_chat_id").references(() => chat.id, {
      onDelete: "set null",
    }),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    source: text("source").notNull().default("manual"),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown>>(),
    agentWeekId: uuid("agent_week_id").references(() => agentWeeks.id, {
      onDelete: "set null",
    }),
    isSelectedForSend: boolean("is_selected_for_send")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("content_calendar_entries_brand_date_idx").on(
      table.brandId,
      table.plannedDate
    ),
    index("content_calendar_entries_brand_status_idx").on(
      table.brandId,
      table.status
    ),
    index("content_calendar_entries_generated_chat_idx").on(table.generatedChatId),
    index("content_calendar_entries_agent_week_idx").on(table.agentWeekId),
  ]
);

export const contentCalendarGenerationTasks = pgTable(
  "content_calendar_generation_tasks",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => contentCalendarEntries.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    status: contentCalendarTaskStatusEnum("status").notNull().default("queued"),
    triggerType: text("trigger_type").notNull(),
    requestedByUserId: text("requested_by_user_id"),
    workflowRunId: text("workflow_run_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("content_calendar_tasks_entry_idx").on(table.entryId),
    index("content_calendar_tasks_brand_status_idx").on(table.brandId, table.status),
    index("content_calendar_tasks_run_idx").on(table.workflowRunId),
  ]
);

export const contentCalendarMonitoringState = pgTable(
  "content_calendar_monitoring_state",
  {
    alertKey: text("alert_key").primaryKey().notNull(),
    severity: text("severity").notNull().default("healthy"),
    isActive: boolean("is_active").notNull().default(false),
    lastFingerprint: text("last_fingerprint"),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastNotificationSentAt: timestamp("last_notification_sent_at", {
      withTimezone: true,
    }),
    consecutiveCount: integer("consecutive_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("content_calendar_monitoring_state_active_idx").on(table.isActive)]
);

export type ContentCalendarEntry = InferSelectModel<typeof contentCalendarEntries>;
export type NewContentCalendarEntry = typeof contentCalendarEntries.$inferInsert;
export type ContentCalendarGenerationTask = InferSelectModel<
  typeof contentCalendarGenerationTasks
>;
export type NewContentCalendarGenerationTask =
  typeof contentCalendarGenerationTasks.$inferInsert;
export type ContentCalendarMonitoringState = InferSelectModel<
  typeof contentCalendarMonitoringState
>;
export type NewContentCalendarMonitoringState =
  typeof contentCalendarMonitoringState.$inferInsert;

// ============================================================================
// Marketing Agent
// ============================================================================

export const agentWeekStatusEnum = pgEnum("agent_week_status", [
  "planning",
  "ideas_selected",
  "generating",
  "generated",
  "reviewing",
  "approved",
  "scheduling",
  "scheduled",
  "sent",
  "error",
]);

export const agentWeeks = pgTable(
  "agent_weeks",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    weekOf: date("week_of", { mode: "date" }).notNull(),
    status: agentWeekStatusEnum("status").notNull().default("planning"),
    sendCount: integer("send_count").notNull().default(2),
    errorMessage: text("error_message"),
    selectionMetadata: jsonb("selection_metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("agent_weeks_brand_week_unique").on(table.brandId, table.weekOf),
    index("agent_weeks_brand_idx").on(table.brandId),
    index("agent_weeks_status_idx").on(table.status),
  ]
);

export const contentCalendarEntryVersions = pgTable(
  "content_calendar_entry_versions",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => contentCalendarEntries.id, { onDelete: "cascade" }),
    chatId: text("chat_id").references(() => chat.id, {
      onDelete: "set null",
    }),
    versionLabel: text("version_label").notNull().default("A"),
    creativeAngle: text("creative_angle"),
    critiqueScore: integer("critique_score"),
    isSelected: boolean("is_selected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("entry_versions_entry_label_unique").on(
      table.entryId,
      table.versionLabel
    ),
    index("entry_versions_entry_idx").on(table.entryId),
    index("entry_versions_chat_idx").on(table.chatId),
  ]
);

export type AgentWeek = InferSelectModel<typeof agentWeeks>;
export type NewAgentWeek = typeof agentWeeks.$inferInsert;
export type ContentCalendarEntryVersion = InferSelectModel<
  typeof contentCalendarEntryVersions
>;
export type NewContentCalendarEntryVersion =
  typeof contentCalendarEntryVersions.$inferInsert;

// ---------------------------------------------------------------------------
// Brand News Profiles (weekly query cache for newsjacking)
// ---------------------------------------------------------------------------

export const brandNewsProfiles = pgTable("brand_news_profiles", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  brandId: text("brand_id")
    .notNull()
    .unique()
    .references(() => brands.id, { onDelete: "cascade" }),
  queries: jsonb("queries").$type<string[]>().notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BrandNewsProfile = InferSelectModel<typeof brandNewsProfiles>;
