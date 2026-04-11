import { incidentio } from "./incidentio";
import { statuspage } from "./statuspage";
import type { Provider, ProviderId, ProviderMonitor, Summary } from "./types";

const PROVIDERS: Record<ProviderId, Provider> = {
  statuspage,
  incidentio,
};

/**
 * Order in which `/monitor add` probes providers.
 *
 * incident.io is probed first because many incident.io pages (e.g.
 * status.openai.com) also expose a Statuspage-compatible `/api/v2/` shim,
 * but that shim returns empty update bodies and a truncated history. Probing
 * incident.io first ensures we use the richer native widget API when
 * available. Statuspage URLs that aren't on incident.io will fail the
 * `/proxy/<host>` probe cleanly (404) and fall through to statuspage.
 */
const PROBE_ORDER: Provider[] = [incidentio, statuspage];

export function getProvider(monitor: ProviderMonitor): Provider {
  const id = monitor.provider ?? "statuspage";
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`Unknown provider "${id}" for monitor with baseUrl ${monitor.baseUrl}.`);
  }
  return provider;
}

export type DetectedProvider = {
  provider: Provider;
  summary: Summary;
};

/**
 * Probe every supported provider for the given base URL. Returns the first
 * match along with an (incidents-empty) summary so `/monitor add` can render
 * the initial embed without an extra request.
 */
export async function detectProvider(baseUrl: string): Promise<DetectedProvider | null> {
  for (const provider of PROBE_ORDER) {
    try {
      const probed = await provider.probe(baseUrl);
      if (probed) {
        return {
          provider,
          summary: { page: probed.page, status: probed.status, incidents: [] },
        };
      }
    } catch {
      // Try next provider.
    }
  }
  return null;
}

export const SUPPORTED_PROVIDERS: readonly Provider[] = PROBE_ORDER;

export type { Provider, ProviderId, ProviderMonitor } from "./types";
