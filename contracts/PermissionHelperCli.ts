#!/usr/bin/env node

import { TableFetcher } from 'eosio-helpers';
import {
  AuthorityToSet,
  EosioAction,
  linkAuth,
  updateAuthAction,
} from 'eosio-helpers/dist/CommonTypes';

import yargs from 'yargs';

import { config } from './config';

const l = (label: string, contents: string) => {
  console.log(label + contents);
};

// const sleepTime = 2000; // ms units

type DacEntry = {
  owner: string;
  accounts: { key: number; value: string }[];
  dac_state: boolean;
  dac_id: string;
  title: string;
  symbol: { symbol: string; contract: string };
  refs: string[];
};

const accountToConfigure = async (dacId: string) => {
  const allDacs: DacEntry[] = await TableFetcher({
    batch_size: 20,
    endpoint: config.endpoint,
    codeContract: 'index.worlds',
    scope: 'index.worlds',
    table: 'dacs',
    limit: 100,
    lower_bound: '',
  });
  return allDacs.find((d) => d.owner == dacId);
};

enum ACCOUNT {
  AUTH = 0,
  TREASURY = 1,
  CUSTODIAN = 2,
  MSIGOWNED = 3,
  SERVICE = 5,
  PROPOSALS = 6,
  ESCROW = 7,
  VOTE_WEIGHT = 8,
  ACTIVATION = 9,
  REFERENDUM = 10,
  SPENDINGS = 11,
  EXTERNAL = 254,
  OTHER = 255,
}

const handlePermActions = async (
  key: ACCOUNT,
  accounts: { [key: number]: string }
) => {
  const actionsToExecute: EosioAction[] = [];
  switch (key) {
    case ACCOUNT.AUTH:
      {
        // Set owner to CUSTODIAN@eosio.code
        // Set active (threshold 1) to 1: AUTH@high and 1: MSIGOWNED
        // Let custodian contract do the rest

        // placeholder to allow it be set in the active permissions below.
        const highPermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.AUTH],
          newPermissionName: 'high',
          parentOfNewPermission: 'active',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.AUTH], permission: 'active' },
          ],
          newControllingAuthToSet: AuthorityToSet.forContractCode(
            accounts[ACCOUNT.CUSTODIAN]
          ),
        });
        const activePermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.AUTH],
          newPermissionName: 'active',
          parentOfNewPermission: 'owner',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.AUTH], permission: 'owner' },
          ],
          newControllingAuthToSet: {
            accounts: [
              {
                permission: {
                  actor: accounts[ACCOUNT.AUTH],
                  permission: 'high',
                },
                weight: 1,
              },
              {
                permission: {
                  actor: accounts[ACCOUNT.MSIGOWNED],
                  permission: 'eosio.code',
                },
                weight: 1,
              },
            ],
            threshold: 1,
            keys: [],
            waits: [],
          },
        });
        const ownerPermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.AUTH],
          newPermissionName: 'owner',
          parentOfNewPermission: '',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.AUTH], permission: 'owner' },
          ],
          newControllingAuthToSet: AuthorityToSet.forContractCode(
            accounts[ACCOUNT.CUSTODIAN]
          ),
        });

        actionsToExecute.push(highPermission);
        actionsToExecute.push(activePermission);
        actionsToExecute.push(ownerPermission);
      }
      break;
    case ACCOUNT.TREASURY:
      // Set owner to be AUTH@active
      // Set active to be AUTH@active
      // Add xfer (child of active) with AUTH@med, CUSTODIAN@eosio.code, PROPOSALS@eosio.code - linkAuth to token::transfer
      //if (PROPOSALS) {
      // Add escrow (child of active) with PROPOSALS@active - LinkAuth ESCROW::approve and ESCROW::init
      //}
      {
        const escrowPermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.TREASURY],
          newPermissionName: 'escrow',
          parentOfNewPermission: 'active',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'active' },
          ],
          newControllingAuthToSet: {
            accounts: [
              {
                permission: {
                  actor: accounts[ACCOUNT.PROPOSALS],
                  permission: 'active',
                },
                weight: 1,
              },
            ],
            threshold: 1,
            keys: [],
            waits: [],
          },
        });
        actionsToExecute.push(escrowPermission);

        const linkEscrowPermissionApprove = linkAuth({
          accountToMakeChangeOn: accounts[ACCOUNT.TREASURY],
          actionName: 'approve',
          contractHoldingLinkAction: accounts[ACCOUNT.ESCROW],
          permissionToPerformAction: 'escrow',
          permittedAuthsToChangeLinkAuths: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'active' },
          ],
        });
        actionsToExecute.push(linkEscrowPermissionApprove);

        const linkEscrowPermissionInit = linkAuth({
          accountToMakeChangeOn: accounts[ACCOUNT.TREASURY],
          actionName: 'init',
          contractHoldingLinkAction: accounts[ACCOUNT.ESCROW],
          permissionToPerformAction: 'escrow',
          permittedAuthsToChangeLinkAuths: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'active' },
          ],
        });
        actionsToExecute.push(linkEscrowPermissionInit);

        const xferPermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.TREASURY],
          newPermissionName: 'xfer',
          parentOfNewPermission: 'active',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'active' },
          ],
          newControllingAuthToSet: {
            accounts: [
              {
                permission: {
                  actor: accounts[ACCOUNT.AUTH],
                  permission: 'med',
                },
                weight: 1,
              },
              {
                permission: {
                  actor: accounts[ACCOUNT.CUSTODIAN],
                  permission: 'eosio.code',
                },
                weight: 1,
              },
              {
                permission: {
                  actor: accounts[ACCOUNT.PROPOSALS],
                  permission: 'eosio.code',
                },
                weight: 1,
              },
            ],
            threshold: 1,
            keys: [],
            waits: [],
          },
        });
        actionsToExecute.push(xferPermission);

        const linkXferAuth = linkAuth({
          accountToMakeChangeOn: accounts[ACCOUNT.TREASURY],
          actionName: 'transfer',
          contractHoldingLinkAction: 'alien.worlds',
          permissionToPerformAction: 'xfer',
          permittedAuthsToChangeLinkAuths: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'active' },
          ],
        });
        actionsToExecute.push(linkXferAuth);

        const activePermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.TREASURY],
          newPermissionName: 'active',
          parentOfNewPermission: 'owner',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'owner' },
          ],
          newControllingAuthToSet: {
            accounts: [
              {
                permission: {
                  actor: accounts[ACCOUNT.AUTH],
                  permission: 'active',
                },
                weight: 1,
              },
            ],
            threshold: 1,
            keys: [],
            waits: [],
          },
        });
        const ownerPermission = updateAuthAction({
          accountToChangePermissionOn: accounts[ACCOUNT.TREASURY],
          newPermissionName: 'owner',
          parentOfNewPermission: '',
          permittedAuthsToChangePermissions: [
            { actor: accounts[ACCOUNT.TREASURY], permission: 'owner' },
          ],
          newControllingAuthToSet: {
            accounts: [
              {
                permission: {
                  actor: accounts[ACCOUNT.AUTH],
                  permission: 'active',
                },
                weight: 1,
              },
            ],
            threshold: 1,
            keys: [],
            waits: [],
          },
        });
        actionsToExecute.push(activePermission);
        actionsToExecute.push(ownerPermission);
      }
      break;
    case ACCOUNT.CUSTODIAN:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      // Add pay (child of active) with CUSTODIAN@eosio.code - link auth to CUSTODIAN::clearstake, CUSTODIAN::removecuspay
      // Add xfer (child of active) with CUSTODIAN@eosio.code AUTHORITY@med - link auth
      break;
    case ACCOUNT.MSIGOWNED:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
    case ACCOUNT.SERVICE:
      // Would be custom for each DAC
      break;
    case ACCOUNT.PROPOSALS:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      // TODO: set up custom child permissions to PROPOSALS
      break;
    case ACCOUNT.ESCROW:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      // TODO: set up custom child permissions to PROPOSALS
      break;
    case ACCOUNT.VOTE_WEIGHT:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
    case ACCOUNT.ACTIVATION:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
    case ACCOUNT.REFERENDUM:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
    case ACCOUNT.EXTERNAL:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
    case ACCOUNT.OTHER:
      // One off setting
      // Set owner to federation@active
      // Set active to federation@active
      break;
  }
};

const run = async () => {
  const opts = await yargs
    .option('submit_to_blockchain', {
      boolean: true,
      default: false,
      desc: 'If true submit actions to blockchain',
      alias: 's',
    })
    .option('dac', {
      string: true,
      demandOption: true,
      desc: 'dac account to look up in the index.worlds directory',
      alias: 'd',
    })
    .parse(process.argv);
  l('opts', JSON.stringify(opts));

  const dacToConfigure = await accountToConfigure(opts.dac);
  l('dac', JSON.stringify(dacToConfigure, null, 4));
  for (const account of dacToConfigure.accounts) {
    l('account:', JSON.stringify(account));
  }
};

run();
