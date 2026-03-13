import {
  deleteLabel,
  getLabel,
  listLabels,
  upsertLabel,
} from '../db/queries.js';

export { getLabel, deleteLabel, listLabels };

export function setLabel(
  address: string,
  type: string,
  name?: string,
  boundary?: boolean,
): void {
  upsertLabel(address, {
    label_type: type,
    label_name: name,
    is_boundary: boundary ? 1 : 0,
    source: 'manual',
    confidence: 1.0,
  });
}

export function setBoundary(address: string, isBoundary: boolean): void {
  const existing = getLabel(address);
  if (existing) {
    upsertLabel(address, { is_boundary: isBoundary ? 1 : 0 });
  } else {
    upsertLabel(address, {
      label_type: 'user',
      is_boundary: isBoundary ? 1 : 0,
      source: 'manual',
      confidence: 1.0,
    });
  }
}
