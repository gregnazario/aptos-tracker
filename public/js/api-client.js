const api = {
  async get(path) {
    const resp = await fetch(`/api${path}`);
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  },

  async post(path, body) {
    const resp = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  },

  async put(path, body) {
    const resp = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  },

  async patch(path, body) {
    const resp = await fetch(`/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  },

  async del(path) {
    const resp = await fetch(`/api${path}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    return resp.json();
  },

  // Convenience methods
  getSankeyData(params) {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.min_amount) qs.set('min_amount', params.min_amount);
    if (params.asset_type) qs.set('asset_type', params.asset_type);
    return this.get(`/graph/sankey?${qs}`);
  },

  getForceData(params) {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.min_amount) qs.set('min_amount', params.min_amount);
    if (params.asset_type) qs.set('asset_type', params.asset_type);
    return this.get(`/graph/force?${qs}`);
  },

  getAssetTypes() {
    return this.get('/transfers/assets');
  },

  triggerSync(address) {
    return this.post('/sync', address ? { address } : {});
  },

  getSyncStatus() {
    return this.get('/sync/status');
  },

  setLabel(address, labelType, labelName, isBoundary) {
    return this.put(`/labels/${address}`, {
      label_type: labelType,
      label_name: labelName,
      is_boundary: isBoundary,
    });
  },

  addAddress(address, alias) {
    return this.post('/addresses', { address, alias });
  },

  updateAddressAlias(address, alias) {
    return this.patch(`/addresses/${address}`, { alias });
  },
};
