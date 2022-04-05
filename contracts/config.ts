import { DACAccounts } from './PermissionHelper';

export const config: { endpoint: string; batchSize: number } & DACAccounts = {
  endpoint: 'http://wax.eosdac.io',
  batchSize: 4,
};
