export interface FilterParams {
  from?: string;
  to?: string;
  min_amount?: number;
  asset_type?: string;
  direction?: string;
  tax_category?: string;
}

export interface AssetInfo {
  asset_type: string;
  display_name: string;
}

export interface TrackedAddress {
  address: string;
  alias: string | null;
  is_active: number;
  added_at: string;
}

export interface SankeyNode {
  id: string;
  name: string;
  label_type: string;
  label_name: string | null;
  is_boundary: number;
  total_volume: number;
  // d3-sankey adds these
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
}

export interface SankeyLink {
  source: number | SankeyNode;
  target: number | SankeyNode;
  value: number;
  asset_type: string;
  asset_name: string | null;
  transfer_count: number;
  // d3-sankey adds this
  width?: number;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface ForceNode {
  id: string;
  name: string;
  alias: string | null;
  label_type: string;
  label_name: string | null;
  is_boundary: number;
  total_volume: number;
  // d3-force adds these
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface ForceLink {
  source: string | ForceNode;
  target: string | ForceNode;
  total_amount: number;
  asset_type: string;
  asset_name: string | null;
  transfer_count: number;
}

export interface ForceData {
  nodes: ForceNode[];
  links: ForceLink[];
}

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const opts: RequestInit = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(`/api${path}`, opts);
  if (!resp.ok) {
    const errorBody = await resp.json().catch(() => null);
    const msg = errorBody?.error || `API error: ${resp.status}`;
    throw new Error(msg);
  }
  return resp.json();
}

function buildFilterQs(params: FilterParams): URLSearchParams {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.min_amount) qs.set('min_amount', String(params.min_amount));
  if (params.asset_type) qs.set('asset_type', params.asset_type);
  if (params.direction) qs.set('direction', params.direction);
  if (params.tax_category) qs.set('tax_category', params.tax_category);
  return qs;
}

export const api = {
  get(path: string) {
    return request('GET', path);
  },

  post(path: string, body?: unknown) {
    return request('POST', path, body);
  },

  put(path: string, body?: unknown) {
    return request('PUT', path, body);
  },

  patch(path: string, body?: unknown) {
    return request('PATCH', path, body);
  },

  del(path: string) {
    return request('DELETE', path);
  },

  getSankeyData(params: FilterParams): Promise<SankeyData> {
    const qs = buildFilterQs(params);
    return request('GET', `/graph/sankey?${qs}`) as Promise<SankeyData>;
  },

  getForceData(params: FilterParams): Promise<ForceData> {
    const qs = buildFilterQs(params);
    return request('GET', `/graph/force?${qs}`) as Promise<ForceData>;
  },

  getAssetTypes(): Promise<AssetInfo[]> {
    return request('GET', '/transfers/assets') as Promise<AssetInfo[]>;
  },

  triggerSync(address?: string, timeRange?: { from?: string; to?: string }) {
    const body: Record<string, any> = {};
    if (address) body.address = address;
    if (timeRange?.from) body.from = timeRange.from;
    if (timeRange?.to) body.to = timeRange.to;
    return request('POST', '/sync', body);
  },

  getSyncStatus() {
    return request('GET', '/sync/status') as Promise<{ syncing: boolean }>;
  },

  setLabel(
    address: string,
    labelType: string,
    labelName: string | null,
    isBoundary: boolean,
  ) {
    return request('PUT', `/labels/${address}`, {
      label_type: labelType,
      label_name: labelName,
      is_boundary: isBoundary,
    });
  },

  addAddress(address: string, alias?: string) {
    return request('POST', '/addresses', { address, alias });
  },

  updateAddressAlias(address: string, alias: string) {
    return request('PATCH', `/addresses/${address}`, { alias });
  },

  getDistinctTaxCategories(): Promise<string[]> {
    return request('GET', '/tax/categories/distinct') as Promise<string[]>;
  },

  upsertTaxCategory(
    pattern: string,
    taxCategory: string,
    matchType = 'exact',
    label?: string,
  ) {
    return request('PUT', `/tax/categories/${encodeURIComponent(pattern)}`, {
      match_type: matchType,
      tax_category: taxCategory,
      label,
    });
  },

  getCategorizedEntryFunctions(): Promise<
    { entry_function: string; count: number; tax_category: string; confidence: number; matched_rule: string | null }[]
  > {
    return request('GET', '/transfers/entry-functions/categorized') as any;
  },

  getWellKnownLabels(): Promise<{
    categories: string[];
    entries: Array<{
      address: string;
      label_type: string;
      label_name: string;
      is_boundary: number;
      category: string;
      description?: string;
      applied: boolean;
    }>;
  }> {
    return request('GET', '/labels/well-known') as any;
  },

  async exportLabels(): Promise<void> {
    const data = await request('GET', '/labels/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aptos-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async importLabels(file: File): Promise<{ labels: number; categories: number }> {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = (await request('POST', '/labels/import', data)) as {
      ok: boolean;
      imported: { labels: number; categories: number };
    };
    return result.imported;
  },
};
