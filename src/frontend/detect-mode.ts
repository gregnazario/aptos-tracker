import { setApiClient } from './api-client.js';
import { localApi } from './local-api-client.js';
import { lsGetLabel, lsGetMode, lsUpsertLabel } from '../storage/local-storage.js';
import { WELL_KNOWN } from '../labels/well-known.js';

let detectedMode: 'server' | 'local' = 'server';

export function getMode(): 'server' | 'local' {
  return detectedMode;
}

export async function initApi(): Promise<void> {
  // Manual override
  const forced = lsGetMode();
  if (forced === 'local' || forced === 'server') {
    detectedMode = forced;
    if (forced === 'local') {
      setApiClient(localApi as any);
      seedWellKnownLabels();
    }
    return;
  }

  // Probe backend
  try {
    const resp = await fetch('/api/addresses', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      detectedMode = 'server';
      return;
    }
    // 4xx/5xx = server is up but broken, stay in server mode
    detectedMode = 'server';
  } catch {
    // Network error or timeout → local mode
    detectedMode = 'local';
    setApiClient(localApi as any);
    seedWellKnownLabels();
  }
}

/** Seed well-known labels into localStorage on first local-mode use */
function seedWellKnownLabels(): void {
  for (const entry of WELL_KNOWN) {
    if (!lsGetLabel(entry.address)) {
      lsUpsertLabel(entry.address, {
        label_type: entry.label_type,
        label_name: entry.label_name,
        is_boundary: entry.is_boundary,
        source: 'well_known',
        confidence: 1.0,
      });
    }
  }
}
