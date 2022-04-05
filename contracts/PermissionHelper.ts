import { debugPromise, EosioAction, UpdateAuth } from 'lamington';

export type DACAccounts = {
  dacToken: string;
  treasury: string;
  custodian: string;
  proposals: string;
  escrow: string;
  msig: string;
  sysToken: string;
  referrendum: string;
  auth: string;
};

export interface WeightWait {
  seconds: number;
  weight: number; // not sure if needed
}

export interface KeyWait {
  key: string;
  weight: number; // not sure if needed
}

export interface PermissionLevel {
  actor: string;
  permission: string;
}

interface PermissionLevelWeight {
  permission: PermissionLevel;
  weight: number;
}

interface AuthorityToSet {
  threshold: number;
  keys: KeyWait[];
  accounts: PermissionLevelWeight[];
  waits: WeightWait[];
}

export const execUpdateAuth = (
  authorizations: PermissionLevel[],
  account: string,
  permission: string,
  parent: string,
  authToSet: AuthorityToSet
): EosioAction => {
  return {
    account,
    authorization: authorizations,
    name: 'updateauth',
    data: { account, permission, parent, auth: authToSet },
  };
};

export const add_token_contract_permissions = async (
  dacAccounts: DACAccounts
) => {
  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'dacToken', permission: 'active' }],
      dacAccounts.dacToken,
      'issue',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'dacToken', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add issue auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'dacToken', permission: 'active' }],
      dacAccounts.dacToken,
      'notify',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'dacToken', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add notify auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'dacToken', permission: 'active' }],
      dacAccounts.dacToken,
      'xfer',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'dacToken', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add xfer auth to eosdactoken'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'treasury', permission: 'active' }],
      dacAccounts.treasury,
      'escrow',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'proposals', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add escrow auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'treasury', permission: 'active' }],
      dacAccounts.treasury,
      'xfer',
      'active',
      UpdateAuth.AuthorityToSet.explicitAuthorities(
        1,
        [
          {
            permission: {
              actor: dacAccounts.custodian,
              permission: 'eosio.code',
            },
            weight: 1,
          },
          {
            permission: {
              actor: dacAccounts.proposals,
              permission: 'eosio.code',
            },
            weight: 1,
          },
        ],
        [],
        []
      )
    ),
    'add xfer to treasury'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'custodian', permission: 'active' }],
      dacAccounts.custodian,
      'pay',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'proposals', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add pay auth to daccustodian'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'escrow', permission: 'owner' }],
      dacAccounts.escrow,
      'active',
      'owner',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'escrow', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'change active of escrow to daccustodian'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'proposals', permission: 'owner' }],
      dacAccounts.proposals,
      'active',
      'owner',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'proposals', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'change active of escrow to dacproposals'
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: dacAccounts.msig, permission: 'owner' }],
    dacAccounts.msig,
    'active',
    'owner',
    UpdateAuth.AuthorityToSet.explicitAuthorities(
      1,
      [
        {
          permission: {
            actor: dacAccounts.msig,
            permission: 'eosio.code',
          },
          weight: 1,
        },
      ],
      [
        {
          key: dacAccounts.msig.publicKey,
          weight: 1,
        },
      ],
      []
    )
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.dacToken,
    'issue',
    'issue'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.dacToken,
    'weightobsv',
    'notify'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'treasury', permission: 'active' }],
    dacAccounts.treasury,
    dacAccounts.escrow,
    'init',
    'escrow'
  );

  await debugPromise(
    UpdateAuth.execLinkAuth(
      [{ actor: 'treasury', permission: 'active' }],
      dacAccounts.treasury,
      dacAccounts.escrow,
      'approve',
      'escrow'
    ),
    'linking escrow perm to treasury'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'treasury', permission: 'active' }],
    dacAccounts.treasury,
    'eosio.token',
    'transfer',
    'xfer'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'treasury', permission: 'active' }],
    dacAccounts.treasury,
    'eosdactokens',
    'transfer',
    'xfer'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'treasury', permission: 'active' }],
    dacAccounts.treasury,
    dacAccounts.sysToken,
    'transfer',
    'xfer'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.custodian,
    'stakeobsv',
    'notify'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.dacToken,
    'refund',
    'notify'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.custodian,
    'balanceobsv',
    'notify'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.custodian,
    'capturestake',
    'notify'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'dacToken', permission: 'active' }],
    dacAccounts.dacToken,
    dacAccounts.dacToken,
    'transfer',
    'xfer'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'custodian', permission: 'active' }],
    dacAccounts.custodian,
    dacAccounts.dacToken,
    'transfer',
    'xfer'
  );

  await UpdateAuth.execLinkAuth(
    [{ actor: 'custodian', permission: 'active' }],
    dacAccounts.custodian,
    dacAccounts.custodian,
    'clearstake',
    'pay'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'owner' }],
      dacAccounts.referrendum,
      'active',
      'owner',
      {
        accounts: [
          {
            weight: 1,
            permission: {
              actor: dacAccounts.referrendum,
              permission: 'eosio.code',
            },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add eosio.code to referrendum'
  );
};

export const add_auth_account_permissions = async (
  dacAccounts: DACAccounts
) => {
  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'owner' }],
      dacAccounts.auth,
      'high',
      'active',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add high auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'owner' }],
      dacAccounts.auth,
      'owner',
      '',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'change owner of auth_account'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'custodian', permission: 'owner' }],
      dacAccounts.custodian,
      'owner',
      '',
      {
        accounts: [
          {
            permission: { actor: dacAccounts.auth, permission: 'active' },
            weight: 1,
          },
        ],
        keys: [],
        waits: [],
        threshold: 1,
      }
    ),
    'changing owner of daccustodian'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'custodian', permission: 'owner' }],
      dacAccounts.custodian,
      'active',
      'owner',
      {
        accounts: [
          {
            permission: { actor: dacAccounts.auth, permission: 'active' },
            weight: 1,
          },
        ],
        keys: [],
        waits: [],
        threshold: 1,
      }
    ),
    'change active of daccustodian'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'active' }],
      dacAccounts.auth,
      'med',
      'high',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add med auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'active' }],
      dacAccounts.auth,
      'low',
      'med',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add low auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'active' }],
      dacAccounts.auth,
      'one',
      'low',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add one auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'active' }],
      dacAccounts.auth,
      'admin',
      'one',
      {
        accounts: [
          {
            weight: 1,
            permission: { actor: 'custodian', permission: 'eosio.code' },
          },
        ],
        keys: [],
        threshold: 1,
        waits: [],
      }
    ),
    'add admin auth'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'auth', permission: 'active' }],
      dacAccounts.auth,
      'referendum',
      'active',
      UpdateAuth.AuthorityToSet.explicitAuthorities(1, [
        {
          permission: {
            actor: dacAccounts.referrendum,
            permission: 'eosio.code',
          },
          weight: 1,
        },
      ])
    ),
    'add referendum to auth_account'
  );

  await debugPromise(
    UpdateAuth.execUpdateAuth(
      [{ actor: 'custodian', permission: 'active' }],
      dacAccounts.custodian,
      'xfer',
      'active',
      UpdateAuth.AuthorityToSet.explicitAuthorities(2, [
        {
          permission: {
            actor: dacAccounts.custodian,
            permission: 'eosio.code',
          },
          weight: 1,
        },
        {
          permission: {
            actor: dacAccounts.auth,
            permission: 'med',
          },
          weight: 1,
        },
      ])
    ),
    'add xfer to daccustodian'
  );
};
