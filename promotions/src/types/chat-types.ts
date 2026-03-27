// New SQL-based types to replace PageState, VersionGroup, and VersionUnit
// These types match our PostgreSQL schema and will be used throughout the app

import type { Chat, Message, MessageArtifact, Vote } from "@/db/main/schema";
import { Brand } from "@/features/editor/properties/brands/brand-themes";
import type { EmailCritiqueMetadata } from "@/features/editor/email-critique/email-critique-schema";
import type { SubjectLineSuggestionsMetadata } from "@/features/editor/subject-line-generator/subject-line-schema";
import type { SmsSuggestionsMetadata } from "@/features/editor/sms-generator/sms-generator-schema";
import type { EmailWorkflowAttemptRecord } from "@/workflows/contracts/email-generation";


// Re-export the base types
export type { Chat, Message, MessageArtifact, Vote };

// Import the full data type from chat-service
export type { ChatWithFullData } from "@/db/main/chat-service";

// Import generation types
import { MessageGenerationMetadata } from "@/types/generation-context";
import { Asset } from "./unified-asset";

// Extended types with helpful utilities
export interface ChatWithData extends Chat {
  messages: Message[];
  artifacts?: Record<string, MessageArtifact>;
  votes?: Vote[];
  brand?: Brand; // Theme data from PostgreSQL
}

// Message parts for structured content
export type MessagePart = 
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; name: string; url: string }
  | { type: 'prompt'; prompt: string }
  | { type: 'raw_output'; content: string };


// Helper type for message with its associated artifact
export interface MessageWithArtifact extends Message {
  artifact?: MessageArtifact;
}

// Status types for tracking generation state
export type GenerationStatus = 'loading' | 'success' | 'error';

// Metadata types for storing additional data
export interface ChatMetadata {
  origin?: 'original' | 'iteration' | 'duplicate';
  intent?: string;
  favoritedBy?: string[];
  selectedMessageId?: string;
  previewText?: string;
  previewScreenshotUrl?: string;
  previewScreenshotGeneratedAt?: string;
  errorMessage?: string | null;
  /**
   * Tracks when a chat was first opened in the preview experience.
   * Absence means it has never been opened.
   */
  firstOpenedAt?: string | null;
  generationStatus?: 'pending' | 'generating' | 'success' | 'error';
  campaignId?: string | null;
  campaignName?: string | null;
  generationExpectedDurationMs?: number;
  generationStatusInfo?: {
    status: 'pending' | 'generating' | 'success' | 'error';
    /** When the generation started - used for accurate timeout detection */
    startedAt?: string;
    updatedAt?: string;
    thinking?: string | null;
    screenshotUrl?: string;
    errorMessage?: string | null;
  };
  /** ID of the email idea that triggered this email creation */
  fromIdeaId?: string | null;
  /** ID of the content calendar entry that triggered this email creation */
  fromCalendarEntryId?: string | null;
  /** Klaviyo export state — set when this email is pushed to Klaviyo */
  klaviyoExport?: {
    campaignId?: string;
    templateId?: string;
    sendJobId?: string;
    scheduledAt?: string;
    status?: "draft" | "scheduled" | "sent";
  };
  workflowEmailGenerationStatusText?: string | null;
  generationStatusHistory?: Array<{
    status: 'pending' | 'generating' | 'success' | 'error';
    timestamp: string;
    thinking?: string | null;
  }>;
}

// Merge MessageMetadata with MessageGenerationMetadata
export interface MessageMetadata extends MessageGenerationMetadata {
  // Additional UI/display metadata
  lastSavedAt?: string;
  screenshotUrl?: string;
  screenshotGeneratedAt?: string;

  previewDesignCritique?: EmailCritiqueMetadata;
  previewSubjectSuggestions?: SubjectLineSuggestionsMetadata;
  previewSmsSuggestions?: SmsSuggestionsMetadata;
  workflowEmailGeneration?: {
    attempts: EmailWorkflowAttemptRecord[];
    latestAttempt?: number;
    accepted?: boolean;
    latestCritiqueScore?: number | null;
    threshold?: number | null;
    experiment?: {
      enableCritiqueLoop: boolean;
      minCritiqueScore: number;
      maxAttempts: number;
    } | null;
    updatedAt?: string;
  };
  // Note: title, mode, status, selectedProducts, isAIRewrite etc. come from MessageGenerationMetadata
  wandEditor?: {
    script?: string;
    json?: string;
    migratedAt?: string;
    tiptapBackup?: {
      raw?: unknown;
      parsed?: unknown;
      capturedAt?: string;
    };
  };
}

// Simplified version info for UI display
export interface SimplifiedMessage {
  id: string;
  title: string;
  prompt: string;
  status: GenerationStatus;
  createdAt: Date;
  mode?: string;
  selectedAssets?: Asset[];
  content?: unknown;
}

// Helper functions for type guards
export function isTextPart(part: MessagePart): part is { type: 'text'; text: string } {
  return part.type === 'text';
}

export function isPromptPart(part: MessagePart): part is { type: 'prompt'; prompt: string } {
  return part.type === 'prompt';
}

export function isFilePart(part: MessagePart): part is { type: 'file'; mediaType: string; name: string; url: string } {
  return part.type === 'file';
}

export function isRawOutputPart(part: MessagePart): part is { type: 'raw_output'; content: string } {
  return part.type === 'raw_output';
}

// Utility function to extract prompt from message parts
export function extractPromptFromMessage(message: Message): string {
  if (!message.parts || !Array.isArray(message.parts)) return '';
  
  const parts = message.parts as MessagePart[];
  const promptPart = parts.find(isPromptPart);
  if (promptPart) return promptPart.prompt;
  
  const textPart = parts.find(isTextPart);
  if (textPart) return textPart.text;
  
  return '';
}
