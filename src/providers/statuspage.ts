import type {
  Incident,
  PageStatus,
  Provider,
  ProviderMonitor,
  Summary,
} from "./types";

type IncidentsResponse = {
  page: Summary["page"];
  incidents: Incident[];
};

async function fetchJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/api/v2${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Statuspage request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export const statuspage: Provider = {
  id: "statuspage",
  displayName: "Statuspage",

  async probe(baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/v2/summary.json`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      const summary = (await response.json()) as Summary;
      if (!summary?.page?.id || !summary?.status?.indicator) return null;
      return { page: summary.page, status: summary.status };
    } catch {
      return null;
    }
  },

  async fetchSummary(monitor: ProviderMonitor): Promise<Summary> {
    return fetchJson<Summary>(monitor.baseUrl, "/summary.json");
  },

  async fetchIncidents(monitor: ProviderMonitor): Promise<Incident[]> {
    const response = await fetchJson<IncidentsResponse>(monitor.baseUrl, "/incidents.json");
    return response.incidents;
  },
};

// Re-export for direct consumers that need the raw PageStatus type.
export type { PageStatus };
