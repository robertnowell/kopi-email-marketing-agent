/**
 * Klaviyo API client functions
 */

import type {
  SuppressionResult,
  ApiKeyCapabilities,
  KlaviyoCampaignCreateInput,
  KlaviyoCampaignCreateResult,
  KlaviyoTemplateCreateInput,
  KlaviyoTemplateCreateResult,
  KlaviyoCampaignMessageInfo,
  KlaviyoTemplateAssignResult,
} from "./klaviyo-types";

const DEFAULT_REVISION = "2026-01-15";

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable (network issues, rate limits, server errors)
 */
export function isRetryableError(status: number): boolean {
  // Retry on rate limit (429), server errors (5xx), or network issues
  return status === 429 || status >= 500;
}

/**
 * Suppress a profile in Klaviyo using the bulk suppression API
 */
export async function suppressProfile(
  apiKey: string,
  email: string,
  revision?: string
): Promise<SuppressionResult> {
  const url = "https://a.klaviyo.com/api/profile-suppression-bulk-create-jobs";

  const body = {
    data: {
      type: "profile-suppression-bulk-create-job",
      attributes: {
        profiles: {
          data: [
            {
              type: "profile",
              attributes: {
                email,
              },
            },
          ],
        },
      },
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        status: response.status,
        jobId: data?.data?.id,
      };
    }

    // Try to get error details
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.errors?.[0]?.detail) {
        errorMessage = errorData.errors[0].detail;
      }
    } catch {
      // Ignore JSON parse errors
    }

    return {
      success: false,
      status: response.status,
      error: errorMessage,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/**
 * Suppress multiple profiles in Klaviyo using the bulk suppression API
 * Max 100 profiles per request (Klaviyo's limit)
 */
export async function suppressProfilesBatch(
  apiKey: string,
  emails: string[],
  revision?: string
): Promise<SuppressionResult> {
  if (emails.length === 0) {
    return { success: true, status: 200 };
  }

  if (emails.length > 100) {
    return {
      success: false,
      status: 400,
      error: `Batch size ${emails.length} exceeds maximum of 100`,
    };
  }

  const url = "https://a.klaviyo.com/api/profile-suppression-bulk-create-jobs";

  const body = {
    data: {
      type: "profile-suppression-bulk-create-job",
      attributes: {
        profiles: {
          data: emails.map((email) => ({
            type: "profile",
            attributes: { email },
          })),
        },
      },
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        status: response.status,
        jobId: data?.data?.id,
      };
    }

    // Try to get error details
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.errors?.[0]?.detail) {
        errorMessage = errorData.errors[0].detail;
      }
    } catch {
      // Ignore JSON parse errors
    }

    return {
      success: false,
      status: response.status,
      error: errorMessage,
    };
  } catch (error) {
    return {
      success: false,
      status: 0,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/**
 * Check if a single Klaviyo API scope is accessible.
 * Returns true if the endpoint responds with 2xx or 400 (has access but bad request).
 * Returns false if 401/403 (no access).
 */
export async function checkScope(
  apiKey: string,
  url: string,
  options?: RequestInit
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: DEFAULT_REVISION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      ...options,
    });
    // 401/403 = no access; anything else (200, 400, etc.) = has access
    return response.status !== 401 && response.status !== 403;
  } catch {
    return false;
  }
}

/**
 * Validate a Klaviyo API key and check available permissions.
 * Checks core scopes (profiles:read, subscriptions:write) as required,
 * and analysis scopes (campaigns, flows, lists, metrics, segments) as optional capabilities.
 */
export async function validateApiKey(
  apiKey: string
): Promise<ApiKeyCapabilities> {
  try {
    // First check profiles:read — if this fails, the key is invalid
    const profilesResponse = await fetch(
      "https://a.klaviyo.com/api/profiles/?page[size]=1",
      {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          revision: DEFAULT_REVISION,
          Accept: "application/json",
        },
      }
    );

    if (
      profilesResponse.status === 401 ||
      profilesResponse.status === 403
    ) {
      return {
        valid: false,
        error: "Invalid API key or insufficient permissions",
        capabilities: {
          suppression: false,
          segmentBrowse: false,
          segmentCreate: false,
          sendingAnalysis: false,
          flowCreate: false,
          campaignCreate: false,
        },
      };
    }

    if (!profilesResponse.ok) {
      return {
        valid: false,
        error: `API returned status ${profilesResponse.status}`,
        capabilities: {
          suppression: false,
          segmentBrowse: false,
          segmentCreate: false,
          sendingAnalysis: false,
          flowCreate: false,
          campaignCreate: false,
        },
      };
    }

    // Check remaining scopes in parallel
    const [
      suppressionOk,
      segmentsOk,
      segmentCreateOk,
      campaignsOk,
      flowsOk,
      listsOk,
      metricsOk,
      flowsWriteOk,
      campaignsWriteOk,
    ] = await Promise.all([
      // subscriptions:write — POST with empty profiles array
      checkScope(
        apiKey,
        "https://a.klaviyo.com/api/profile-suppression-bulk-create-jobs",
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              type: "profile-suppression-bulk-create-job",
              attributes: { profiles: { data: [] } },
            },
          }),
        }
      ),
      // segments:read
      checkScope(apiKey, "https://a.klaviyo.com/api/segments/?page[size]=1"),
      // segments:write — PATCH non-existent segment (404 = has access, 403 = no access)
      checkScope(apiKey, "https://a.klaviyo.com/api/segments/NONEXISTENT_CHECK/", {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "segment",
            id: "NONEXISTENT_CHECK",
            attributes: {
              definition: { condition_groups: [] },
            },
          },
        }),
      }),
      // campaigns:read
      checkScope(apiKey, "https://a.klaviyo.com/api/campaigns/?page[size]=1"),
      // flows:read
      checkScope(apiKey, "https://a.klaviyo.com/api/flows/?page[size]=1"),
      // lists:read
      checkScope(apiKey, "https://a.klaviyo.com/api/lists/?page[size]=1"),
      // metrics:read
      checkScope(apiKey, "https://a.klaviyo.com/api/metrics/?page[size]=1"),
      // flows:write — POST with empty body (400 = has access, 403 = no access)
      checkScope(apiKey, "https://a.klaviyo.com/api/flows/", {
        method: "POST",
        body: JSON.stringify({ data: { type: "flow", attributes: {} } }),
      }),
      // campaigns:write — POST with empty body (400 = has access, 403 = no access)
      checkScope(apiKey, "https://a.klaviyo.com/api/campaigns/", {
        method: "POST",
        body: JSON.stringify({ data: { type: "campaign", attributes: {} } }),
      }),
    ]);

    const sendingAnalysis =
      campaignsOk && flowsOk && listsOk && metricsOk && segmentsOk;

    return {
      valid: true,
      error: !suppressionOk
        ? "API key is missing subscriptions:write scope — suppression features will be unavailable"
        : undefined,
      capabilities: {
        suppression: suppressionOk,
        segmentBrowse: segmentsOk,
        segmentCreate: segmentCreateOk,
        sendingAnalysis,
        flowCreate: flowsWriteOk,
        campaignCreate: campaignsWriteOk,
      },
    };
  } catch (error) {
    return {
      valid: false,
      error:
        error instanceof Error ? error.message : "Failed to validate API key",
      capabilities: {
        suppression: false,
        segmentBrowse: false,
        segmentCreate: false,
        sendingAnalysis: false,
        flowCreate: false,
        campaignCreate: false,
      },
    };
  }
}

/**
 * List all segments for the Klaviyo account.
 * Returns id and name for each segment (profile counts require individual getSegmentMetadata calls).
 */
export async function listSegments(
  apiKey: string,
  revision?: string
): Promise<Array<{ id: string; name: string }>> {
  const segments: Array<{ id: string; name: string }> = [];
  let url: string | null =
    "https://a.klaviyo.com/api/segments/";

  while (url) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.errors?.[0]?.detail) {
          errorMessage = errorData.errors[0].detail;
        }
      } catch {
        // ignore
      }
      throw new Error(`Failed to list segments: ${errorMessage}`);
    }

    const data = await response.json();
    for (const seg of data?.data ?? []) {
      segments.push({
        id: seg.id,
        name: seg.attributes?.name ?? "Unnamed",
      });
    }

    url = data?.links?.next ?? null;
  }

  return segments;
}

/**
 * Fetch a single segment's metadata (name and profile count).
 * Uses the additional-fields parameter which has tighter rate limits (1/s burst, 15/min steady)
 * but is fine for a single call before fetching profiles.
 */
export async function getSegmentMetadata(
  apiKey: string,
  segmentId: string,
  revision?: string
): Promise<{ name: string; profileCount: number; isProcessing: boolean }> {
  const url = `https://a.klaviyo.com/api/segments/${encodeURIComponent(segmentId)}/?additional-fields[segment]=profile_count&fields[segment]=name,is_processing`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData?.errors?.[0]?.detail) {
        errorMessage = errorData.errors[0].detail;
      }
    } catch {
      // ignore
    }
    throw new Error(`Failed to fetch segment metadata: ${errorMessage}`);
  }

  const data = await response.json();
  return {
    name: data?.data?.attributes?.name ?? "Unnamed Segment",
    profileCount: data?.data?.attributes?.profile_count ?? 0,
    isProcessing: data?.data?.attributes?.is_processing ?? false,
  };
}

/**
 * Fetch a segment's definition (condition groups).
 * Uses fields[segment]=name,definition — 75/s burst rate (fast path, no additional-fields penalty).
 */
export async function getSegmentDefinition(
  apiKey: string,
  segmentId: string,
  revision?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ id: string; name: string; conditionGroups: any[] }> {
  const url = `https://a.klaviyo.com/api/segments/${encodeURIComponent(segmentId)}/?fields[segment]=name,definition`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch segment definition: ${await extractErrorMessage(response)}`
    );
  }

  const data = await response.json();
  const attrs = data?.data?.attributes ?? {};
  return {
    id: data?.data?.id ?? segmentId,
    name: attrs.name ?? "Unnamed",
    conditionGroups: attrs.definition?.condition_groups ?? [],
  };
}

/**
 * Fetch all profile emails from a Klaviyo segment using cursor pagination.
 * Caps at maxProfiles to prevent runaway fetches.
 * Optional onProgress callback fires after each page with the running total.
 */
export async function getSegmentProfiles(
  apiKey: string,
  segmentId: string,
  maxProfiles = 50000,
  revision?: string,
  onProgress?: (loaded: number) => void
): Promise<string[]> {
  const emails: string[] = [];
  let url: string | null =
    `https://a.klaviyo.com/api/segments/${encodeURIComponent(segmentId)}/profiles/?page[size]=100&fields[profile]=email`;

  while (url && emails.length < maxProfiles) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.errors?.[0]?.detail) {
          errorMessage = errorData.errors[0].detail;
        }
      } catch {
        // ignore
      }
      throw new Error(`Failed to fetch segment profiles: ${errorMessage}`);
    }

    const data = await response.json();
    for (const profile of data?.data ?? []) {
      const email = profile?.attributes?.email;
      if (email && emails.length < maxProfiles) {
        emails.push(email.toLowerCase().trim());
      }
    }

    onProgress?.(emails.length);

    url = data?.links?.next ?? null;
  }

  return emails;
}

/**
 * Verify a profile is actually suppressed in Klaviyo
 * Used for post-suppression verification
 */
export async function verifyProfileSuppressed(
  apiKey: string,
  email: string
): Promise<{ found: boolean; suppressed: boolean; error?: string }> {
  const url = `https://a.klaviyo.com/api/profiles/?filter=equals(email,'${encodeURIComponent(email)}')&additional-fields[profile]=subscriptions`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      return {
        found: false,
        suppressed: false,
        error: `API returned status ${response.status}`,
      };
    }

    const data = await response.json();
    const profile = data?.data?.[0];

    if (!profile) {
      return { found: false, suppressed: false };
    }

    // Check if the profile has suppressed status in subscriptions
    const subscriptions = profile?.attributes?.subscriptions;
    const emailMarketing = subscriptions?.email?.marketing;

    // If suppressed, the consent status should be "NEVER_SUBSCRIBED" or similar
    // or the suppressions array should contain entries
    const suppressions = emailMarketing?.suppressions || [];

    return { found: true, suppressed: suppressions.length > 0 };
  } catch (error) {
    return {
      found: false,
      suppressed: false,
      error:
        error instanceof Error ? error.message : "Failed to verify suppression",
    };
  }
}

// ============================================================================
// Sending Analysis Client Functions
// ============================================================================

/**
 * Extract error message from a Klaviyo API error response
 */
async function extractErrorMessage(response: Response): Promise<string> {
  let errorMessage = `HTTP ${response.status}`;
  try {
    const errorData = await response.json();
    if (errorData?.errors?.[0]?.detail) {
      errorMessage = errorData.errors[0].detail;
    }
  } catch {
    // ignore JSON parse errors
  }
  return errorMessage;
}

/**
 * List all email campaigns. Sorted client-side by send_time desc.
 */
export async function listCampaigns(
  apiKey: string,
  revision?: string
): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    sendTime: string | null;
    audiences: { included: string[]; excluded: string[] };
  }>
> {
  const campaigns: Array<{
    id: string;
    name: string;
    status: string;
    sendTime: string | null;
    audiences: { included: string[]; excluded: string[] };
  }> = [];

  let url: string | null =
    "https://a.klaviyo.com/api/campaigns/?filter=equals(messages.channel,'email')&fields[campaign]=name,status,send_time,audiences,send_options";

  while (url) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list campaigns: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const c of data?.data ?? []) {
      const attrs = c.attributes ?? {};
      const audiences = attrs.audiences ?? {};
      campaigns.push({
        id: c.id,
        name: attrs.name ?? "Unnamed",
        status: attrs.status ?? "unknown",
        sendTime: attrs.send_time ?? null,
        audiences: {
          included: audiences.included ?? [],
          excluded: audiences.excluded ?? [],
        },
      });
    }

    url = data?.links?.next ?? null;
  }

  // Sort by send_time desc (API sort by send_time is invalid)
  campaigns.sort((a, b) => {
    if (!a.sendTime && !b.sendTime) return 0;
    if (!a.sendTime) return 1;
    if (!b.sendTime) return -1;
    return new Date(b.sendTime).getTime() - new Date(a.sendTime).getTime();
  });

  return campaigns;
}

/**
 * Get per-campaign performance report.
 * Rate limit: 1/s burst, 2/min steady — handles 429 with backoff.
 */
export async function getCampaignReport(
  apiKey: string,
  conversionMetricId: string,
  timeframe: { start: string; end: string },
  revision?: string
): Promise<
  Array<{
    campaignId: string;
    recipients: number;
    openRate: number;
    clickRate: number;
  }>
> {
  const body = {
    data: {
      type: "campaign-values-report",
      attributes: {
        statistics: [
          "recipients",
          "opens",
          "open_rate",
          "clicks",
          "click_rate",
        ],
        timeframe,
        conversion_metric_id: conversionMetricId,
      },
    },
  };

  const maxRetries = 3;
  const retryDelays = [30000, 60000, 90000]; // 30s, 60s, 90s for 2/min rate limit

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(
      "https://a.klaviyo.com/api/campaign-values-reports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          revision: revision || DEFAULT_REVISION,
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const results = data?.data?.attributes?.results ?? [];
      return results.map(
        (r: {
          groupings?: { campaign_id?: string };
          statistics?: {
            recipients?: number;
            open_rate?: number;
            click_rate?: number;
          };
        }) => ({
          campaignId: r.groupings?.campaign_id ?? "",
          recipients: r.statistics?.recipients ?? 0,
          openRate: r.statistics?.open_rate ?? 0,
          clickRate: r.statistics?.click_rate ?? 0,
        })
      );
    }

    if (response.status === 429 && attempt < maxRetries) {
      await sleep(retryDelays[attempt]);
      continue;
    }

    throw new Error(
      `Failed to get campaign report: ${await extractErrorMessage(response)}`
    );
  }

  // Unreachable, but TypeScript needs it
  throw new Error("Failed to get campaign report: max retries exceeded");
}

/**
 * List all lists (no profile counts — use getListWithCount for individual counts).
 */
export async function listLists(
  apiKey: string,
  revision?: string
): Promise<Array<{ id: string; name: string }>> {
  const lists: Array<{ id: string; name: string }> = [];
  let url: string | null =
    "https://a.klaviyo.com/api/lists/?fields[list]=name";

  while (url) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list lists: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const l of data?.data ?? []) {
      lists.push({
        id: l.id,
        name: l.attributes?.name ?? "Unnamed",
      });
    }

    url = data?.links?.next ?? null;
  }

  return lists;
}

/**
 * Get a single list with profile count.
 * Uses additional-fields which has tighter rate limits (1/s burst, 15/min steady).
 */
export async function getListWithCount(
  apiKey: string,
  listId: string,
  revision?: string
): Promise<{ id: string; name: string; profileCount: number }> {
  const url = `https://a.klaviyo.com/api/lists/${encodeURIComponent(listId)}/?additional-fields[list]=profile_count`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get list: ${await extractErrorMessage(response)}`
    );
  }

  const data = await response.json();
  return {
    id: data?.data?.id ?? listId,
    name: data?.data?.attributes?.name ?? "Unnamed",
    profileCount: data?.data?.attributes?.profile_count ?? 0,
  };
}

/**
 * List all flows with name, status, and trigger type.
 */
export async function listFlows(
  apiKey: string,
  revision?: string
): Promise<
  Array<{ id: string; name: string; status: string; triggerType: string }>
> {
  const flows: Array<{
    id: string;
    name: string;
    status: string;
    triggerType: string;
  }> = [];
  let url: string | null =
    "https://a.klaviyo.com/api/flows/?fields[flow]=name,status,trigger_type";

  while (url) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list flows: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const f of data?.data ?? []) {
      const attrs = f.attributes ?? {};
      flows.push({
        id: f.id,
        name: attrs.name ?? "Unnamed",
        status: attrs.status ?? "unknown",
        triggerType: attrs.trigger_type ?? "unknown",
      });
    }

    url = data?.links?.next ?? null;
  }

  return flows;
}

/**
 * Fetch a flow's definition via additional-fields[flow]=definition.
 * Returns the triggers array (SegmentTrigger, ListTrigger, MetricTrigger, etc.).
 * Rate limit: Burst 3/s, Steady 60/m.
 */
export async function getFlowDefinition(
  apiKey: string,
  flowId: string,
  revision?: string
): Promise<{
  triggers: Array<{ type: string; id?: string }>;
}> {
  const url = `https://a.klaviyo.com/api/flows/${encodeURIComponent(flowId)}/?additional-fields[flow]=definition&fields[flow]=definition`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get flow definition: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  const definition = data?.data?.attributes?.definition ?? {};
  return {
    triggers: definition.triggers ?? [],
  };
}

export interface FlowActionInfo {
  id: string;
  type: string;
  actionType: string;
  status: string;
  created: string | null;
  updated: string | null;
  data: Record<string, unknown> | null;
  links: {
    next: string | null;
    nextIfTrue: string | null;
    nextIfFalse: string | null;
  };
  /** Flow-message IDs resolved from relationship endpoint. */
  messageIds: string[];
  /** URL for resolving message IDs (set for email actions). */
  messageRelUrl: string | null;
}

/**
 * Get flow actions for a specific flow.
 * Hardcodes revision 2026-01-15 — on 2024-10-15, definition.type/data/links are null.
 * Requests action_type, status, created, updated via sparse fieldset for A/B detection.
 *
 * Does NOT resolve message IDs — call resolveActionMessageIds separately
 * to avoid rate-limit contention when multiple flows are fetched in parallel.
 */
export async function getFlowActions(
  apiKey: string,
  flowId: string
): Promise<FlowActionInfo[]> {
  const headers = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: "2026-01-15",
    Accept: "application/json",
  };

  let url: string | null =
    `https://a.klaviyo.com/api/flows/${encodeURIComponent(flowId)}/flow-actions`;

  const actions: FlowActionInfo[] = [];

  while (url) {
    const response: Response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      throw new Error(
        `Failed to get flow actions: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const a of data?.data ?? []) {
      const attrs = a.attributes ?? {};
      const definition = attrs.definition ?? {};
      const defLinks = definition.links ?? {};
      const type = definition.type ?? "unknown";
      const isEmail =
        type === "send-email" || type === "email" || type.includes("email");

      actions.push({
        id: a.id,
        type,
        actionType: attrs.action_type ?? "",
        status: attrs.status ?? "",
        created: attrs.created ?? null,
        updated: attrs.updated ?? null,
        data: definition.data ?? null,
        links: {
          next: defLinks.next ?? null,
          nextIfTrue: defLinks.next_if_true ?? null,
          nextIfFalse: defLinks.next_if_false ?? null,
        },
        messageIds: [],
        messageRelUrl: isEmail
          ? (a.relationships?.["flow-messages"]?.links?.self ?? null)
          : null,
      });
    }

    url = data?.links?.next ?? null;
  }

  return actions;
}

/**
 * Resolve message IDs for email actions via lightweight relationship endpoints.
 * Batches of 3 concurrent requests with 350ms spacing and retry on 429.
 *
 * MUST be called sequentially per flow (not in parallel across flows) to
 * avoid Klaviyo rate-limit contention (3/s burst, 60/min steady).
 */
export async function resolveActionMessageIds(
  apiKey: string,
  actions: FlowActionInfo[]
): Promise<void> {
  const headers = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: "2026-01-15",
    Accept: "application/json",
  };

  const emailActions = actions.filter((a) => a.messageRelUrl);
  const REL_BATCH = 3;

  for (let i = 0; i < emailActions.length; i += REL_BATCH) {
    const batch = emailActions.slice(i, i + REL_BATCH);
    await Promise.all(
      batch.map(async (action) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            if (attempt > 0) await sleep(1000 * attempt);
            const resp = await fetch(action.messageRelUrl!, {
              method: "GET",
              headers,
            });
            if (resp.status === 429) {
              const retryAfter = Number(resp.headers.get("Retry-After")) || 2;
              await sleep(retryAfter * 1000);
              continue;
            }
            if (resp.ok) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const relData: any = await resp.json();
              action.messageIds = (relData?.data ?? [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((d: any) => d?.id)
                .filter(Boolean);
            }
            break;
          } catch {
            // Network error — retry
          }
        }
      })
    );
    if (i + REL_BATCH < emailActions.length) await sleep(350);
  }
}

/**
 * Create a new flow in Klaviyo (draft status).
 * Actions are linked in sequence via temporary IDs.
 */
export async function createFlow(
  apiKey: string,
  params: {
    name: string;
    triggerSegmentId: string;
    actions: Array<{
      tempId: string;
      type: string;
      data?: Record<string, unknown>;
    }>;
  }
): Promise<{ flowId: string }> {
  // Build action definitions linked in sequence
  const actionDefs = params.actions.map((action, i) => {
    const nextTempId = i < params.actions.length - 1 ? params.actions[i + 1].tempId : null;
    return {
      temporary_id: action.tempId,
      type: action.type,
      data: action.data ?? {},
      links: {
        next: nextTempId,
      },
    };
  });

  const payload = {
    data: {
      type: "flow",
      attributes: {
        name: params.name,
        definition: {
          triggers: [
            {
              type: "segment",
              id: params.triggerSegmentId,
            },
          ],
          actions: actionDefs,
          entry_action_id: params.actions[0]?.tempId ?? null,
        },
      },
    },
  };

  const response = await fetch("https://a.klaviyo.com/api/flows/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: DEFAULT_REVISION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create flow: ${await extractErrorMessage(response)}`
    );
  }

  const data = await response.json();
  return { flowId: data?.data?.id };
}

/**
 * List all metrics (used to find "Clicked Email" metric ID for campaign reports).
 */
export async function getMetrics(
  apiKey: string,
  revision?: string
): Promise<Array<{ id: string; name: string; integration: string | null }>> {
  const metrics: Array<{ id: string; name: string; integration: string | null }> = [];
  let url: string | null = "https://a.klaviyo.com/api/metrics/";

  while (url) {
    const response: Response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list metrics: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const m of data?.data ?? []) {
      metrics.push({
        id: m.id,
        name: m.attributes?.name ?? "Unnamed",
        integration: m.attributes?.integration?.name ?? null,
      });
    }

    url = data?.links?.next ?? null;
  }

  return metrics;
}

/**
 * Query total sum_value for a metric over the last 30 days.
 * Used to validate whether a conversion metric has actual revenue data.
 * Rate limit: 3/s burst, 60/min steady (separate bucket from reporting).
 */
export async function queryMetricAggregate(
  apiKey: string,
  metricId: string,
  revision?: string
): Promise<number> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const body = {
    data: {
      type: "metric-aggregate",
      attributes: {
        metric_id: metricId,
        measurements: ["sum_value"],
        filter: [
          `greater-or-equal(datetime,${thirtyDaysAgo.toISOString()})`,
          `less-than(datetime,${now.toISOString()})`,
        ],
      },
    },
  };

  const response = await fetch("https://a.klaviyo.com/api/metric-aggregates/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errMsg = await extractErrorMessage(response);
    console.warn(`[metric-aggregates] Failed for metric ${metricId}: ${errMsg}`);
    return 0;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  const measurements = data?.data?.attributes?.data ?? [];
  if (measurements.length > 0 && measurements[0]?.measurements?.sum_value != null) {
    const values: number[] = measurements[0].measurements.sum_value;
    return values.reduce((a: number, b: number) => a + b, 0);
  }
  return 0;
}

/**
 * Poll a segment until is_processing becomes false, then return profile count.
 * Uses additional-fields rate limit (1/s burst, 15/min steady).
 */
export async function pollSegmentCount(
  apiKey: string,
  segmentId: string,
  intervalMs = 5000,
  timeoutMs = 120000
): Promise<number | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(intervalMs);
    try {
      const meta = await getSegmentMetadata(apiKey, segmentId);
      if (!meta.isProcessing) {
        return meta.profileCount;
      }
    } catch {
      // Transient error — keep polling
    }
  }
  return null;
}

/**
 * Create a segment in Klaviyo.
 * Rate limit: 1/s burst, 15/min steady, 100/day.
 */
export async function createSegment(
  apiKey: string,
  name: string,
  conditionGroups: Array<{ conditions: Array<Record<string, unknown>> }>,
  revision?: string
): Promise<{ id: string; name: string; isProcessing: boolean }> {
  const body = {
    data: {
      type: "segment",
      attributes: {
        name,
        definition: {
          condition_groups: conditionGroups,
        },
      },
    },
  };

  const response = await fetch("https://a.klaviyo.com/api/segments/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create segment: ${await extractErrorMessage(response)}`
    );
  }

  const data = await response.json();
  const attrs = data?.data?.attributes ?? {};
  return {
    id: data?.data?.id ?? "",
    name: attrs.name ?? name,
    isProcessing: attrs.is_processing ?? true,
  };
}

/**
 * Update an existing segment's definition (PATCH).
 * Used to fix conditions on already-created segments without deleting them.
 */
export async function updateSegment(
  apiKey: string,
  segmentId: string,
  conditionGroups: Array<{ conditions: Array<Record<string, unknown>> }>,
  revision?: string
): Promise<{ id: string; isProcessing: boolean }> {
  const body = {
    data: {
      type: "segment",
      id: segmentId,
      attributes: {
        definition: {
          condition_groups: conditionGroups,
        },
      },
    },
  };

  const response = await fetch(
    `https://a.klaviyo.com/api/segments/${segmentId}/`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to update segment: ${await extractErrorMessage(response)}`
    );
  }

  const data = await response.json();
  const attrs = data?.data?.attributes ?? {};
  return {
    id: data?.data?.id ?? segmentId,
    isProcessing: attrs.is_processing ?? true,
  };
}

// ---------------------------------------------------------------------------
// Flow Performance Reporting
// ---------------------------------------------------------------------------

export interface FlowValuesReportRow {
  flowId: string;
  flowMessageId: string;
  flowName: string;
  flowMessageName: string;
  sendChannel: string;
  variation: string | null;
  statistics: {
    openRate: number;
    clickRate: number;
    clickToOpenRate: number;
    conversionRate: number;
    conversionValue: number;
    revenuePerRecipient: number;
    recipients: number;
    bounceRate: number;
    unsubscribeRate: number;
    spamComplaintRate: number;
  };
}

const ENGAGEMENT_STATISTICS = [
  "open_rate",
  "click_rate",
  "click_to_open_rate",
  "recipients",
  "bounce_rate",
  "unsubscribe_rate",
  "spam_complaint_rate",
] as const;

const CONVERSION_STATISTICS = [
  "conversion_rate",
  "conversion_value",
  "revenue_per_recipient",
] as const;

/**
 * Get flow performance report via the Reporting API.
 * Rate limit: 1/s burst, 2/min steady, 225/day — single call returns ALL flows.
 * Optional filter param: e.g. `equals(flow_id,"ABC123")` to request a specific flow.
 */
export async function getFlowValuesReport(
  apiKey: string,
  conversionMetricId: string | null,
  timeframe: string | { start: string; end: string },
  revision?: string,
  includeConversionStats: boolean = !!conversionMetricId,
  filter?: string
): Promise<FlowValuesReportRow[]> {
  const statistics: string[] = [
    ...ENGAGEMENT_STATISTICS,
    ...(includeConversionStats ? CONVERSION_STATISTICS : []),
  ];

  const timeframeAttr =
    typeof timeframe === "string" ? { key: timeframe } : timeframe;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attributes: Record<string, any> = {
    statistics,
    timeframe: timeframeAttr,
    group_by: [
      "flow_id",
      "flow_message_id",
      "flow_name",
      "flow_message_name",
      "send_channel",
      "variation",
    ],
  };

  // Klaviyo requires conversion_metric_id even for engagement-only requests
  if (conversionMetricId) {
    attributes.conversion_metric_id = conversionMetricId;
  }

  if (filter) {
    attributes.filter = filter;
  }

  const body = {
    data: {
      type: "flow-values-report",
      attributes,
    },
  };

  const maxRetries = 3;
  const retryDelays = [30000, 60000, 90000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(
      "https://a.klaviyo.com/api/flow-values-reports",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          revision: revision || DEFAULT_REVISION,
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) {
      const data = await response.json();
      const results = data?.data?.attributes?.results ?? [];

      if (results.length > 0) {
        const sample = results[0];
        console.log(
          "[flow-values-report] raw stats keys:",
          JSON.stringify(Object.keys(sample.statistics ?? {}))
        );
        console.log(
          "[flow-values-report] sample raw stats:",
          JSON.stringify(sample.statistics ?? {})
        );
        console.log(
          "[flow-values-report] requested stats:",
          JSON.stringify(statistics)
        );
      }

      return results.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (r: any) => ({
          flowId: r.groupings?.flow_id ?? "",
          flowMessageId: r.groupings?.flow_message_id ?? "",
          flowName: r.groupings?.flow_name ?? "",
          flowMessageName: r.groupings?.flow_message_name ?? "",
          sendChannel: r.groupings?.send_channel ?? "",
          variation: r.groupings?.variation ?? null,
          statistics: {
            openRate: r.statistics?.open_rate ?? 0,
            clickRate: r.statistics?.click_rate ?? 0,
            clickToOpenRate: r.statistics?.click_to_open_rate ?? 0,
            conversionRate: r.statistics?.conversion_rate ?? 0,
            conversionValue: r.statistics?.conversion_value ?? 0,
            revenuePerRecipient: r.statistics?.revenue_per_recipient ?? 0,
            recipients: r.statistics?.recipients ?? 0,
            bounceRate: r.statistics?.bounce_rate ?? 0,
            unsubscribeRate: r.statistics?.unsubscribe_rate ?? 0,
            spamComplaintRate: r.statistics?.spam_complaint_rate ?? 0,
          },
        })
      );
    }

    if (response.status === 429 && attempt < maxRetries) {
      await sleep(retryDelays[attempt]);
      continue;
    }

    throw new Error(
      `Failed to get flow values report: ${await extractErrorMessage(response)}`
    );
  }

  throw new Error("Failed to get flow values report: max retries exceeded");
}

/**
 * Get the template for a flow message (email content).
 * Rate limit: 3/s burst, 60/min steady.
 */
export async function getFlowMessageTemplate(
  apiKey: string,
  messageId: string,
  revision?: string
): Promise<{
  name: string;
  html: string;
  text: string;
  editorType: string;
  subjectLine?: string;
  previewText?: string;
}> {
  const rev = revision || DEFAULT_REVISION;
  const headers = {
    Authorization: `Klaviyo-API-Key ${apiKey}`,
    revision: rev,
    Accept: "application/json",
  };

  const templateUrl = `https://a.klaviyo.com/api/flow-messages/${encodeURIComponent(messageId)}/template?fields[template]=name,html,text,editor_type`;
  const actionUrl = `https://a.klaviyo.com/api/flow-messages/${encodeURIComponent(messageId)}/flow-action?fields[flow-action]=definition`;

  const [templateRes, actionRes] = await Promise.all([
    fetch(templateUrl, { method: "GET", headers }),
    fetch(actionUrl, { method: "GET", headers }).catch(() => null),
  ]);

  if (!templateRes.ok) {
    throw new Error(
      `Failed to get flow message template: ${await extractErrorMessage(templateRes)}`
    );
  }

  const templateData = await templateRes.json();
  const attrs = templateData?.data?.attributes ?? {};

  let subjectLine: string | undefined;
  let previewText: string | undefined;
  if (actionRes?.ok) {
    try {
      const actionData = await actionRes.json();
      const def = actionData?.data?.attributes?.definition;
      subjectLine = def?.data?.message?.subject_line;
      previewText = def?.data?.message?.preview_text;
    } catch {
      // subject line is best-effort
    }
  }

  return {
    name: attrs.name ?? "",
    html: attrs.html ?? "",
    text: attrs.text ?? "",
    editorType: attrs.editor_type ?? "",
    subjectLine,
    previewText,
  };
}

/**
 * Get flow messages for a specific flow action.
 * Used to map action IDs (from action graph) to message IDs (from report data).
 * Rate limit: 3/s burst, 60/min steady.
 */
export async function getFlowActionMessages(
  apiKey: string,
  actionId: string,
  revision?: string
): Promise<Array<{ id: string; name: string }>> {
  const messages: Array<{ id: string; name: string }> = [];
  let url: string | null = `https://a.klaviyo.com/api/flow-actions/${encodeURIComponent(actionId)}/flow-messages`;

  while (url) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to get flow action messages: ${await extractErrorMessage(response)}`
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    for (const m of data?.data ?? []) {
      messages.push({
        id: m.id,
        name: m.attributes?.name ?? "",
      });
    }

    url = data?.links?.next ?? null;
  }

  return messages;
}

// ============================================================================
// Campaign write functions (agent marketing automation)
// ============================================================================

/**
 * Create a Klaviyo template with raw HTML (editor_type: "CODE").
 */
export async function createKlaviyoTemplate(
  apiKey: string,
  input: KlaviyoTemplateCreateInput,
  revision?: string
): Promise<KlaviyoTemplateCreateResult> {
  const response = await fetch("https://a.klaviyo.com/api/templates", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
    },
    body: JSON.stringify({
      data: {
        type: "template",
        attributes: {
          name: input.name,
          html: input.html,
          editor_type: "CODE",
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create Klaviyo template: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  return { templateId: data?.data?.id };
}

/**
 * Create a draft Klaviyo campaign with inline campaign-message.
 * from_email/from_label auto-populate from Klaviyo account settings.
 */
export async function createKlaviyoCampaign(
  apiKey: string,
  input: KlaviyoCampaignCreateInput,
  revision?: string
): Promise<KlaviyoCampaignCreateResult> {
  const response = await fetch("https://a.klaviyo.com/api/campaigns", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Klaviyo-API-Key ${apiKey}`,
      revision: revision || DEFAULT_REVISION,
    },
    body: JSON.stringify({
      data: {
        type: "campaign",
        attributes: {
          name: input.name,
          audiences: {
            included: [input.segmentId],
            excluded: [],
          },
          "campaign-messages": {
            data: [
              {
                type: "campaign-message",
                attributes: {
                  definition: {
                    channel: "email",
                    label: "default",
                    content: {
                      subject: input.subject,
                      preview_text: input.previewText,
                    },
                  },
                },
              },
            ],
          },
          send_strategy: {
            method: "static",
            datetime: input.sendDatetime,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create Klaviyo campaign: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  return {
    campaignId: data?.data?.id,
    status: data?.data?.attributes?.status ?? "Draft",
  };
}

/**
 * Get a campaign with its messages included (to extract campaign-message ID).
 */
export async function getKlaviyoCampaignWithMessages(
  apiKey: string,
  campaignId: string,
  revision?: string
): Promise<KlaviyoCampaignMessageInfo> {
  const response = await fetch(
    `https://a.klaviyo.com/api/campaigns/${encodeURIComponent(campaignId)}?include=campaign-messages`,
    {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get Klaviyo campaign: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  const included = data?.included ?? [];
  const campaignMessage = included.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (item: any) => item.type === "campaign-message"
  );

  if (!campaignMessage?.id) {
    throw new Error(
      `Campaign ${campaignId} has no campaign-message in included response`
    );
  }

  return { campaignMessageId: campaignMessage.id };
}

/**
 * Assign a template to a campaign message.
 * Uses the dedicated POST /api/campaign-message-assign-template endpoint.
 */
export async function assignTemplateToKlaviyoCampaignMessage(
  apiKey: string,
  input: { campaignMessageId: string; templateId: string },
  revision?: string
): Promise<KlaviyoTemplateAssignResult> {
  const response = await fetch(
    "https://a.klaviyo.com/api/campaign-message-assign-template",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
      },
      body: JSON.stringify({
        data: {
          type: "campaign-message",
          id: input.campaignMessageId,
          relationships: {
            template: {
              data: {
                type: "template",
                id: input.templateId,
              },
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to assign template to campaign message: ${await extractErrorMessage(response)}`
    );
  }

  return { success: true };
}

/**
 * Create a send job to schedule a campaign.
 */
export async function scheduleKlaviyoCampaign(
  apiKey: string,
  campaignId: string,
  revision?: string
): Promise<{ sendJobId: string }> {
  const response = await fetch(
    "https://a.klaviyo.com/api/campaign-send-jobs",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
      },
      body: JSON.stringify({
        data: {
          type: "campaign-send-job",
          attributes: {
            campaign_id: campaignId,
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to schedule Klaviyo campaign: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  return { sendJobId: data?.data?.id };
}

/**
 * Check the status of a campaign send job.
 */
export async function getKlaviyoSendJobStatus(
  apiKey: string,
  sendJobId: string,
  revision?: string
): Promise<{ status: string }> {
  const response = await fetch(
    `https://a.klaviyo.com/api/campaign-send-jobs/${encodeURIComponent(sendJobId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        revision: revision || DEFAULT_REVISION,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get send job status: ${await extractErrorMessage(response)}`
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await response.json();
  return { status: data?.data?.attributes?.status ?? "unknown" };
}
