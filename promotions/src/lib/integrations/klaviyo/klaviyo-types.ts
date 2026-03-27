/**
 * TypeScript types for Klaviyo integration
 */

/**
 * Integration mode - single 3-state instead of 2 toggles
 */
export type SunsetMode = "inactive" | "test" | "live";

/**
 * Klaviyo-specific settings stored in integration_connections.settings
 */
export interface KlaviyoSettings {
  mode: SunsetMode;
  klaviyoRevision?: string;
  sendingAnalysis?: SendingAnalysisResult;
  kopiActiveProfilesSegmentId?: string;
  manualActiveProfileCount?: number;
  manualActiveProfileCountUpdatedAt?: string;
  apiKeyCapabilities?: {
    suppression: boolean;
    segmentBrowse: boolean;
    segmentCreate: boolean;
    sendingAnalysis: boolean;
    flowCreate?: boolean;
    campaignCreate?: boolean;
  };
  createdSunsetFlowId?: string;
  deadWeightTriage?: DeadWeightTriageResult;
  flowPerformance?: Record<string, FlowPerformanceResult>;
  validatedConversionMetricId?: string;
  agentSettings?: {
    defaultSegmentId?: string;
    defaultSendTimes?: string[];
    defaultFromEmail?: string;
    defaultFromLabel?: string;
  };
}

/**
 * Result of the dead weight triage: 4 diagnostic segments + counts
 */
export interface DeadWeightTriageResult {
  deadWeightSegmentId: string;
  deadWeightCount: number;
  missedOpportunitiesSegmentId: string;
  missedOpportunitiesCount: number;
  deliverabilitySegmentId: string;
  deliverabilityCount: number;
  sunsetSegmentId: string;
  sunsetCount: number;
  totalTriaged: number;
  triagedAt: string;
  integrationWarnings: string[];
  metricsUsed: string[];
  sunsetLeakSegmentId?: string;
  sunsetLeakCount?: number;
  sunsetCoveragePercent?: number;
  emailReachedSegmentId?: string;
  emailReachedCount?: number;
  emailReachedPct?: number;
  suppressionJobId?: string;
  suppressionStatus?: "pending" | "processing" | "complete";
}

/**
 * Klaviyo credentials stored encrypted
 */
export interface KlaviyoCredentials {
  apiKey: string;
}

/**
 * Result of a suppression API call
 */
export interface SuppressionResult {
  success: boolean;
  status: number;
  jobId?: string;
  error?: string;
}

/**
 * Webhook processing result
 */
export interface WebhookResult {
  status:
    | "success"
    | "not_found"
    | "unauthorized"
    | "disabled"
    | "rate_limited"
    | "duplicate"
    | "dry_run"
    | "failed";
  message?: string;
}

/**
 * Stats returned by the stats endpoint
 */
export interface SunsetStats {
  suppressed7d: number;
  suppressed30d: number;
  suppressedAllTime: number;
  estimatedMonthlySavings: number;
}

/**
 * Health metrics for the dashboard
 */
export interface SunsetHealth {
  lastWebhookReceived: Date | null;
  lastSuccessfulSuppression: Date | null;
  errorRate24h: number;
  klaviyoApiStatus: "healthy" | "degraded" | "down";
}

/**
 * Daily suppression data for chart
 */
export interface DailySuppression {
  date: string;
  count: number;
}

/**
 * Full sunset data response
 */
export interface SunsetData {
  isConnected: boolean;
  mode: SunsetMode;
  webhookUrl: string | null;
  webhookSecret: string | null;
  stats: SunsetStats;
  health: SunsetHealth;
  dailySuppressions: DailySuppression[];
  failedCount: number;
  capabilities?: {
    suppression: boolean;
    segmentBrowse: boolean;
    segmentCreate: boolean;
    sendingAnalysis: boolean;
  } | null;
  createdSunsetFlowId?: string | null;
}

/**
 * Cost per profile for savings calculation
 * Klaviyo charges approximately $0.01-0.02 per profile per month
 */
export const COST_PER_PROFILE = 0.01;

/**
 * Result of a sending analysis run, stored in integration settings JSONB
 */
export interface SendingAnalysisResult {
  avgBreadthRatio: number;
  breadthLabel: "broad" | "moderate" | "conservative";
  campaignDetails: Array<{
    campaignId: string;
    name: string;
    recipients: number;
    breadthRatio: number;
    sendTime: string;
  }>;
  hasSunsetFlow: boolean;
  sunsetFlowName?: string;
  reEngagementLengthDays?: number;
  pruningLabel: "strict" | "moderate" | "lenient";
  activeProfileCount: number | null;
  activeProfileSource: "segment" | "manual" | null;
  maxCampaignRecipients: number;
  deadWeightPct: number | null;
  balanceLabel: "balanced" | "risky" | "growth-limited";
  recommendations: string[];
  redFlags: string[];
  totalListProfiles: number;
  flowSummary: Array<{ id: string; name: string; status: string; type: string }>;
  analyzedAt: string;
  campaignCount: number;

  campaignSegmentAnalysis?: {
    effectiveEngagementWindowDays: number | null;
    segmentSummaries: Array<{
      segmentId: string;
      segmentName: string;
      engagementWindowDays: number | null;
      engagementMetrics: string[];
      hasPurchaseRecency: boolean;
      isListBased: boolean;
      summary: string;
    }>;
    excludeSegmentSummaries: Array<{
      segmentId: string;
      segmentName: string;
      category: string;
      summary: string;
    }>;
    hasEngagementExclusions: boolean;
  };

  sunsetTriggerAnalysis?: {
    triggerSegmentId: string | null;
    triggerSegmentName: string | null;
    inactivityWindowDays: number | null;
    engagementMetrics: string[];
    hasPurchaseRecency: boolean;
    hasSuppressionAction: boolean;
    conditionsFallback: boolean;
    requiresPriorEngagement: boolean;
    onlyChecksOpens: boolean;
    summary: string;
  };
}

// ---------------------------------------------------------------------------
// Flow Performance types
// ---------------------------------------------------------------------------

export type FlowCategory =
  | "conversion"
  | "post_purchase"
  | "retention"
  | "transactional"
  | "uncategorized";

export type PerformanceDimension = "subject_line" | "content" | "conversion";

export type RecommendationType =
  | "improve_subject"
  | "improve_content"
  | "improve_conversion"
  | "create_ab_challenger"
  | "increase_ab_coverage"
  | "add_emails"
  | "missing_flow"
  | "stale_flow"
  | "high_unsub_rate"
  | "stale_ab_test";

export type Severity = "critical" | "high" | "medium" | "low";

export interface FlowStats {
  openRate: number;
  clickRate: number;
  clickToOpenRate: number;
  conversionRate: number;
  revenuePerRecipient: number;
  bounceRate: number;
  unsubscribeRate: number;
  spamComplaintRate: number;
}

export interface VariationStats {
  name: string;
  recipients: number;
  stats: FlowStats;
}

export interface EmailPerformance {
  messageId: string;
  messageName: string;
  recipients: number;
  stats: FlowStats;
  percentiles: Record<PerformanceDimension, number>;
  hasAbTest: boolean;
  variationBreakdown: VariationStats[];
  actionCreated: string | null;
  actionStatus: string | null;
}

/**
 * Returns true if the email has historical A/B data but the test appears
 * to be resolved (one variation has >75% of recipients).
 */
export function isAbTestResolved(email: EmailPerformance): boolean {
  if (!email.hasAbTest) return false;
  const variations = email.variationBreakdown ?? [];
  if (variations.length < 2) return false;
  const total = variations.reduce((sum, v) => sum + v.recipients, 0);
  if (total === 0) return false;
  const maxShare = Math.max(...variations.map((v) => v.recipients)) / total;
  return maxShare > 0.75;
}

/**
 * Whether the email currently has an actively-running A/B test
 * (i.e. has variation data AND the test hasn't been resolved yet).
 */
export function hasActiveAbTest(email: EmailPerformance): boolean {
  return email.hasAbTest && !isAbTestResolved(email);
}

export interface FlowPerformance {
  flowId: string;
  flowName: string;
  status: string;
  triggerType: string;
  category: FlowCategory;
  activeEmailCount: number;
  hasBranching: boolean;
  hasAbTesting: boolean;
  abCoveragePercent: number;
  recipients: number;
  stats: FlowStats;
  percentiles: Record<PerformanceDimension, number>;
  overallScore: number;
  emails: EmailPerformance[];
}

export interface Recommendation {
  type: RecommendationType;
  severity: Severity;
  flowId?: string;
  flowName?: string;
  messageId?: string;
  title: string;
  reason: string;
  evidence?: string;
  confidence: "high" | "medium";
  recipients?: number;
  priorityScore?: number;
}

export interface FlowPerformanceResult {
  flows: FlowPerformance[];
  recommendations: Recommendation[];
  missingFlows: string[];
  analyzedAt: string;
  timeframe: string;
  hasConversionMetric: boolean;
  /** Total live/manual flows in the account when analysis ran. Absent in data cached before this field was added. */
  liveFlowCount?: number;
}

/**
 * Capabilities of a Klaviyo API key, returned by validateApiKey
 */
export interface ApiKeyCapabilities {
  valid: boolean;
  error?: string;
  capabilities: {
    suppression: boolean;
    segmentBrowse: boolean;
    segmentCreate: boolean;
    sendingAnalysis: boolean;
    flowCreate: boolean;
    campaignCreate: boolean;
  };
}

// ---------------------------------------------------------------------------
// Campaign write types (agent marketing automation)
// ---------------------------------------------------------------------------

export interface KlaviyoCampaignCreateInput {
  name: string;
  segmentId: string;
  subject: string;
  previewText: string;
  /** ISO-8601 datetime for scheduled send, e.g. "2026-04-01T14:00:00+00:00" */
  sendDatetime: string;
}

export interface KlaviyoTemplateCreateInput {
  name: string;
  html: string;
}

export interface KlaviyoCampaignCreateResult {
  campaignId: string;
  status: string;
}

export interface KlaviyoTemplateCreateResult {
  templateId: string;
}

export interface KlaviyoCampaignMessageInfo {
  campaignMessageId: string;
}

export interface KlaviyoTemplateAssignResult {
  success: boolean;
}
