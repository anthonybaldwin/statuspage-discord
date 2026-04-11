/**
 * Canonical internal types shared between providers and the rest of the bot.
 *
 * Every provider normalizes its API responses into these shapes so that polling,
 * rendering, state, and commands stay provider-agnostic.
 */

export type ProviderId = "statuspage" | "incidentio";

export type PageStatus = {
  indicator: string;
  description: string;
};

export type IncidentUpdate = {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at?: string;
};

export type Incident = {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink?: string;
  created_at: string;
  updated_at?: string;
  resolved_at?: string | null;
  incident_updates: IncidentUpdate[];
};

export type Summary = {
  page: {
    id: string;
    name: string;
    url: string;
    updated_at?: string;
  };
  status: PageStatus;
  incidents: Incident[];
};

/**
 * Minimal structural type that providers accept. The full MonitorConfig (with
 * zod parsing, channelId, label, etc.) lives in src/index.ts but passes
 * structurally through this interface, avoiding a circular import.
 */
export type ProviderMonitor = {
  baseUrl: string;
  provider?: ProviderId;
};

export type Provider = {
  id: ProviderId;
  /** Display name shown in user-facing strings like thread reasons. */
  displayName: string;
  /**
   * Probe a base URL to confirm this provider can serve it. Returns a
   * normalized `{ page, status }` on success, or `null` if this provider
   * cannot handle the URL. Implementations should not throw on 4xx/5xx — they
   * should return `null` so the next provider in probe order gets a chance.
   */
  probe(baseUrl: string): Promise<{ page: Summary["page"]; status: PageStatus } | null>;
  /** Active-only summary used by `/status`, `/testpost`, and `/monitor add`. */
  fetchSummary(monitor: ProviderMonitor): Promise<Summary>;
  /** Full incident history (including resolved) used by the polling loop. */
  fetchIncidents(monitor: ProviderMonitor): Promise<Incident[]>;
};
