import { loadDatasets } from '../data/load';
export function loadData() { return loadDatasets(['overview', 'villages', 'rollout', 'anchors', 'overlap', 'robustness', 'coverage'] as const); }
