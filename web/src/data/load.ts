import type { WebDatasets } from '../data.generated.ts';

type DatasetName = keyof WebDatasets;
type Rule = { type: string | string[]; enum?: unknown[]; pattern?: string };
type Definition = { 'x-primary-key': string[]; properties: { rows: { minItems: number; items: { required: string[]; properties: Record<string, Rule> } } } };
type Manifest = { schema_version: string; schemas: { sha256: string }; datasets: Record<DatasetName, { sha256: string }> };
const pending = new Map<DatasetName, Promise<WebDatasets[DatasetName]>>();
const downloads = new Map<string, Promise<string>>();
let contract: Promise<{ manifest: Manifest; schemas: { $defs: Record<DatasetName, Definition> } }> | undefined;
function read(name: string): Promise<string> {
  let promise = downloads.get(name);
  if (!promise) {
    promise = (async () => {
      const response = await fetch(`/data/${name}.json`);
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Public data could not be loaded.');
      return response.text();
    })();
    downloads.set(name, promise);
    void promise.catch(() => { if (downloads.get(name) === promise) downloads.delete(name); });
  }
  return promise;
}
async function checked(body: string, hash: string) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), byte => byte.toString(16).padStart(2, '0')).join('');
  if (digest !== hash) throw new Error('Public data integrity check failed.');
  return JSON.parse(body);
}
function loadContract() {
  if (!contract) {
    const promise = (async () => {
      const [manifestBody, schemaBody] = await Promise.all([read('manifest'), read('schemas')]);
      const manifest: Manifest = JSON.parse(manifestBody);
      if (manifest.schema_version !== '1.0.0') throw new Error('Unsupported public data version.');
      const schemas = await checked(schemaBody, manifest.schemas.sha256);
      return { manifest, schemas };
    })();
    contract = promise;
    void promise.catch(() => {
      if (contract === promise) {
        contract = undefined;
        downloads.delete('manifest');
        downloads.delete('schemas');
      }
    });
  }
  return contract;
}
export function validateDocument(name: DatasetName, document: unknown, schema: Definition) {
  if (!document || typeof document !== 'object') throw new Error('Public data shape is invalid.');
  const { rows, schema_name, schema_version } = document as { rows: unknown; schema_name: unknown; schema_version: unknown };
  const { required, properties } = schema.properties.rows.items;
  if (schema_name !== name || schema_version !== '1.0.0' || !Array.isArray(rows) || rows.length !== schema.properties.rows.minItems) throw new Error('Public data shape is invalid.');
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Object.keys(row).length !== required.length || !required.every(field => Object.hasOwn(row, field))) throw new Error('Unexpected public data fields.');
    for (const field of required) {
      const value = row[field], rule = properties[field];
      const types = Array.isArray(rule.type) ? rule.type : [rule.type];
      const valid = value === null ? types.includes('null') : types.some(type => type === 'integer' ? Number.isSafeInteger(value) : type === typeof value);
      if (!valid || typeof value === 'number' && !Number.isFinite(value) || rule.enum && !rule.enum.includes(value)
          || rule.pattern && !new RegExp(rule.pattern).test(value)) throw new Error('Public data value is invalid.');
    }
  }
  if (new Set(rows.map(row => JSON.stringify(schema['x-primary-key'].map(key => row[key])))).size !== rows.length) throw new Error('Duplicate public data key.');
}
export function loadDataset<N extends DatasetName>(name: N): Promise<WebDatasets[N]> {
  let promise = pending.get(name);
  if (!promise) {
    promise = (async () => {
      const [{ manifest, schemas }, body] = await Promise.all([loadContract(), read(name)]);
      const document = await checked(body, manifest.datasets[name].sha256);
      validateDocument(name, document, schemas.$defs[name]);
      return document as WebDatasets[N];
    })();
    pending.set(name, promise);
    void promise.catch(() => {
      if (pending.get(name) === promise) {
        pending.delete(name);
        downloads.delete(name);
      }
    });
  }
  return promise as Promise<WebDatasets[N]>;
}
export async function loadDatasets<N extends DatasetName>(names: readonly N[]): Promise<Pick<WebDatasets, N>> {
  const entries = await Promise.all(names.map(async name => [name, await loadDataset(name)]));
  return Object.fromEntries(entries) as Pick<WebDatasets, N>;
}
