import {
  Account,
  AccountManager,
  EOSManager,
  ContractDeployer,
  sleep,
  generateTypes,
  debugPromise,
  UpdateAuth,
} from 'lamington';

// Dac contracts
import { Dacdirectory } from './dacdirectory/dacdirectory';
import { Daccustodian } from './daccustodian/daccustodian';
import { Eosdactokens } from './eosdactokens/eosdactokens';
import { Msigworlds } from './msigworlds/msigworlds';
import { Dacproposals } from './dacproposals/dacproposals';
import { Dacescrow } from './dacescrow/dacescrow';
import { Referendum } from './referendum/referendum';
import { EosioToken } from '../../external_contracts/eosio.token/eosio.token';
import { Atomicassets } from '../../external_contracts/atomicassets/atomicassets';

import * as fs from 'fs';
import * as path from 'path';
import {
  add_auth_account_permissions,
  add_token_contract_permissions,
} from './PermissionHelper';

export var NUMBER_OF_REG_MEMBERS = 16;
export var NUMBER_OF_CANDIDATES = 7;

export class SharedTestObjects {
  // Shared Instances to use between tests.
  private static instance: SharedTestObjects;
  private constructor() {}

  auth_account: Account;
  treasury_account: Account;
  // === Dac Contracts
  dacdirectory_contract: Dacdirectory;
  daccustodian_contract: Daccustodian;
  dac_token_contract: Eosdactokens;
  dacproposals_contract: Dacproposals;
  dacescrow_contract: Dacescrow;
  msigworlds_contract: Msigworlds;
  eosio_token_contract: EosioToken;
  referendum_contract: Referendum;
  tokenIssuer: Account;
  atomicassets: Atomicassets;

  // === Shared Values
  configured_dac_memberterms: string;

  NFT_COLLECTION: string;

  constructor() {
    this.NFT_COLLECTION = 'alien.worlds';
  }

  static async getInstance(): Promise<SharedTestObjects> {
    if (!SharedTestObjects.instance) {
      SharedTestObjects.instance = new SharedTestObjects();
      await SharedTestObjects.instance.initAndGetSharedObjects();
    }
    return SharedTestObjects.instance;
  }

  private async initAndGetSharedObjects() {
    console.log('Init eos blockchain');
    // await sleep(500);
    // EOSManager.initWithDefaults();

    this.auth_account = await debugPromise(
      AccountManager.createAccount('eosdacauth'),
      'create eosdacauth'
    );
    this.treasury_account = await debugPromise(
      AccountManager.createAccount('treasury'),
      'create treasury account'
    );

    await EOSManager.transact({
      actions: [
        {
          account: 'eosio.token',
          name: 'transfer',
          authorization: [
            {
              actor: 'eosio',
              permission: 'active',
            },
          ],
          data: {
            from: 'eosio',
            to: 'treasury',
            quantity: '1000.0000 EOS',
            memo: 'Some money for the treasury',
          },
        },
      ],
    });

    // Configure Dac contracts
    this.dacdirectory_contract = await ContractDeployer.deployWithName(
      'contracts/dacdirectory/dacdirectory',
      'dacdirectory'
    );
    this.daccustodian_contract = await debugPromise(
      ContractDeployer.deployWithName(
        'contracts/daccustodian/daccustodian',
        'daccustodian'
      ),
      'created daccustodian'
    );
    this.dac_token_contract = await debugPromise(
      ContractDeployer.deployWithName(
        'contracts/eosdactokens/eosdactokens',
        'eosdactokens'
      ),
      'created eosdactokens'
    );
    this.dacproposals_contract = await debugPromise(
      ContractDeployer.deployWithName(
        'contracts/dacproposals/dacproposals',
        'dacproposals'
      ),
      'created dacproposals'
    );
    this.dacescrow_contract = await debugPromise(
      ContractDeployer.deployWithName(
        'contracts/dacescrow/dacescrow',
        'dacescrow'
      ),
      'created dacescrow'
    );
    this.msigworlds_contract = await debugPromise(
      ContractDeployer.deployWithName<Msigworlds>(
        'contracts/msigworlds/msigworlds',
        'msig.world'
      ),
      'created msigworlds_contract'
    );

    this.referendum_contract = await debugPromise(
      ContractDeployer.deployWithName<Referendum>(
        'contracts/referendum/referendum',
        'referendum'
      ),
      'created referendum_contract'
    );

    this.atomicassets = await ContractDeployer.deployWithName<Atomicassets>(
      'contracts/atomicassets/atomicassets',
      'atomicassets'
    );
    this.atomicassets.account.addCodePermission();
    await this.atomicassets.init({ from: this.atomicassets.account });

    // Other objects
    this.configured_dac_memberterms = 'be2c9d0494417cf7522cd8d6f774477c';
    await this.configTokenContract();
    await add_auth_account_permissions({
      auth: this.auth_account,
      custodian: this.daccustodian_contract.account,
      dacToken: this.dac_token_contract.account,
      sysToken: this.eosio_token_contract.account,
      treasury: this.treasury_account,
      referrendum: this.referendum_contract.account,
      msig: this.msigworlds_contract.account,
      proposals: this.dacproposals_contract.account,
      escrow: this.dacescrow_contract.account,
    });
    await add_token_contract_permissions({
      auth: this.auth_account,
      custodian: this.daccustodian_contract.account,
      dacToken: this.dac_token_contract.account,
      sysToken: this.eosio_token_contract.account,
      treasury: this.treasury_account,
      referrendum: this.referendum_contract.account,
      msig: this.msigworlds_contract.account,
      proposals: this.dacproposals_contract.account,
      escrow: this.dacescrow_contract.account,
    });
  }

  async setup_new_auth_account() {
    this.auth_account = await debugPromise(
      AccountManager.createAccount(),
      'create eosdacauth'
    );
    await add_auth_account_permissions({
      auth: this.auth_account,
      custodian: this.daccustodian_contract.account,
      dacToken: this.dac_token_contract.account,
      sysToken: this.eosio_token_contract.account,
      treasury: this.treasury_account,
      referrendum: this.referendum_contract.account,
      msig: this.msigworlds_contract.account,
      proposals: this.dacproposals_contract.account,
      escrow: this.dacescrow_contract.account,
    });
  }

  async initDac(
    dacId: string,
    symbol: string,
    initialAsset: string,
    planet?: Account
  ) {
    await this.setup_new_auth_account();
    // Further setup after the inital singleton object have been created.
    await this.setup_tokens(initialAsset);
    await this.register_dac_with_directory(dacId, symbol, planet);
    await this.setup_dac_memberterms(dacId, this.auth_account);
  }

  async updateconfig(dacId: string, lockupAsset: string) {
    await this.daccustodian_contract.updateconfige(
      {
        numelected: 5,
        maxvotes: 4,
        requested_pay_max: {
          contract: 'eosio.token',
          quantity: '30.0000 EOS',
        },
        periodlength: 5,
        initial_vote_quorum_percent: 31,
        vote_quorum_percent: 15,
        auth_threshold_high: 4,
        auth_threshold_mid: 3,
        auth_threshold_low: 2,
        lockupasset: {
          contract: this.dac_token_contract.account.name,
          quantity: lockupAsset,
        },
        should_pay_via_service_provider: false,
        lockup_release_time_delay: 1233,
      },
      dacId,
      { from: this.auth_account }
    );
  }

  async getRegMembers(
    dacId: string,
    initialDacAsset: string,
    count: number = NUMBER_OF_REG_MEMBERS
  ): Promise<Account[]> {
    const newMembers = await AccountManager.createAccounts(count);

    const termsPromises = newMembers
      .map((account) => {
        return debugPromise(
          this.dac_token_contract.memberreg(
            account.name,
            this.configured_dac_memberterms,
            dacId,
            { from: account }
          ),
          `Registered member: ${account.name}`
        );
      })
      .concat(
        newMembers.map((account) => {
          return this.dac_token_contract.transfer(
            this.dac_token_contract.account.name,
            account.name,
            initialDacAsset,
            '',
            { from: this.dac_token_contract.account }
          );
        })
      );

    await debugPromise(
      Promise.all(termsPromises),
      'running `getRegMembers`: ' + count
    );
    return newMembers;
  }

  async getStakeObservedCandidates(
    dacId: string,
    dacStakeAsset: string,
    count: number = NUMBER_OF_CANDIDATES
  ): Promise<Account[]> {
    const newCandidates = await this.getRegMembers(dacId, dacStakeAsset, count);
    for (const { candidate, index } of newCandidates.map(
      (candidate, index) => ({
        candidate,
        index,
      })
    )) {
      await debugPromise(
        this.dac_token_contract.stake(candidate.name, dacStakeAsset, {
          from: candidate,
        }),
        'staking for candidate'
      );
      const indexOption = index % 3;
      let payAmount = '';
      if (indexOption == 0) {
        payAmount = '15.0000 EOS';
      } else if (indexOption == 1) {
        payAmount = '20.0000 EOS';
      } else {
        payAmount = '25.0000 EOS';
      }
      await debugPromise(
        this.daccustodian_contract.nominatecane(
          candidate.name,
          payAmount,
          dacId,
          {
            from: candidate,
          }
        ),
        'nominate candidate'
      );
    }
    return newCandidates;
  }

  private async setup_tokens(initialAsset: string) {
    await this.dac_token_contract.create(
      this.dac_token_contract.account.name,
      initialAsset,
      false,
      { from: this.dac_token_contract.account }
    );
    await this.dac_token_contract.issue(
      this.dac_token_contract.account.name,
      initialAsset,
      'Initial Token holder',
      { from: this.dac_token_contract.account }
    );
  }

  // tokenSymbol is the symbol in this format: '4,EOSDAC'
  private async register_dac_with_directory(
    dacId: string,
    tokenSymbol: string,
    planet?: Account
  ) {
    const accounts = [
      {
        key: Account_type.CUSTODIAN,
        value: this.daccustodian_contract.account.name,
      },
      {
        key: Account_type.ESCROW,
        value: this.dacescrow_contract.account.name,
      },
      {
        key: Account_type.TREASURY,
        value: this.treasury_account.name,
      },
    ];
    if (planet) {
      accounts.push({
        key: Account_type.MSIGOWNED,
        value: planet.name,
      });
    }

    await this.dacdirectory_contract.regdac(
      this.auth_account.name,
      dacId,
      {
        contract: this.dac_token_contract.account.name,
        sym: tokenSymbol,
      },
      'dac_title',
      [],
      accounts,
      {
        auths: [
          { actor: this.auth_account.name, permission: 'active' },
          { actor: this.treasury_account.name, permission: 'active' },
        ],
      }
    );
  }

  async setup_dac_memberterms(dacId: string, dacAuth: Account) {
    await debugPromise(
      this.dac_token_contract.newmemterms(
        'https://raw.githubusercontent.com/eosdac/eosdac-constitution/master/constitution.md',
        this.configured_dac_memberterms,
        dacId,
        { from: dacAuth }
      ),
      'setting member terms'
    );
  }

  async voteForCustodians(
    regMembers: Account[],
    electedCandidates: Account[],
    dacId: string
  ) {
    // Running 2 loops through different sections of members to spread 4 votes each over at least 5 candidates.

    for (let index = 0; index < 8; index++) {
      const mbr = regMembers[index];
      await debugPromise(
        this.daccustodian_contract.votecust(
          mbr.name,
          [
            electedCandidates[0].name,
            electedCandidates[1].name,
            electedCandidates[2].name,
            electedCandidates[3].name,
          ],
          dacId,
          { from: mbr }
        ),
        'voting custodian for new period'
      );
    }
    for (let index = 8; index < 16; index++) {
      const mbr = regMembers[index];
      await debugPromise(
        this.daccustodian_contract.votecust(
          mbr.name,
          [
            electedCandidates[0].name,
            electedCandidates[1].name,
            electedCandidates[2].name,
            electedCandidates[4].name,
          ],
          dacId,
          { from: mbr }
        ),
        'voting custodian for new period'
      );
    }
  }

  async configTokenContract() {
    this.eosio_token_contract =
      await ContractDeployer.deployWithName<EosioToken>(
        'external_contracts/eosio.token/eosio.token',
        'alien.worlds'
      );

    this.tokenIssuer = await AccountManager.createAccount('tokenissuer');

    await this.eosio_token_contract.create(
      this.tokenIssuer.name,
      '1000000000.0000 TLM',
      {
        from: this.eosio_token_contract.account,
      }
    );
    await this.eosio_token_contract.issue(
      this.tokenIssuer.name,
      '10000000.0000 TLM',
      'initial deposit',
      {
        from: this.tokenIssuer,
      }
    );
  }
}

// Not used for now but could be useful later
async function setup_external(name: string) {
  const compiled_dir = path.normalize(
    `${__dirname}/../artifacts/compiled_contracts/${name}`
  );

  if (!fs.existsSync(compiled_dir)) {
    fs.mkdirSync(compiled_dir);
  }

  fs.copyFileSync(
    `${__dirname}/external_contracts/${name}.wasm`,
    `${compiled_dir}/${name}.wasm`
  );
  fs.copyFileSync(
    `${__dirname}/external_contracts/${name}.abi`,
    `${compiled_dir}/${name}.abi`
  );

  await debugPromise(
    generateTypes(`contracts/external_contracts/${name}/${name}`),
    'generating types for external contract: ' + name
  );
}

export enum Account_type {
  TREASURY = 1,
  CUSTODIAN = 2,
  MSIGOWNED = 3,
  SERVICE = 5,
  PROPOSALS = 6,
  ESCROW = 7,
  VOTING = 8,
  EXTERNAL = 254,
  OTHER = 255,
}

enum ref_type {
  HOMEPAGE = 0,
  LOGO_URL = 1,
  DESCRIPTION = 2,
  LOGO_NOTEXT_URL = 3,
  BACKGROUND_URL = 4,
  COLORS = 5,
  CLIENT_EXTENSION = 6,
}

enum dac_state_type {
  dac_state_typeINACTIVE = 0,
  dac_state_typeACTIVE = 1,
}
