import {
  AccountManager,
  Account,
  UpdateAuth,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  sleep,
  assertRowCount,
  assertEOSException,
} from 'lamington';
import { SharedTestObjects, Account_type } from '../TestHelpers';

const api = EOSManager.api;

import { Msigworlds } from './msigworlds';
import { EosioToken } from '../../external_contracts/eosio.token/eosio.token';
import { expect } from 'chai';

let msigworlds: Msigworlds;
let eosioToken: EosioToken;
let tokenIssuer: Account;

let owner1: Account;
let owner2: Account;
let owner3: Account;
let msigowned: Account;

let modDate: Date;

const dac_id = 'msigdac';

export const currentHeadTimeWithAddedSeconds = async (seconds: number) => {
  const { head_block_time } = await EOSManager.api.rpc.get_info();
  const date = new Date(new Date(head_block_time).getTime() + seconds * 1000);
  return date;
};

describe('Msigworlds', () => {
  let shared: SharedTestObjects;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    msigworlds = shared.msigworlds_contract;
    tokenIssuer = shared.tokenIssuer;
    eosioToken = shared.eosio_token_contract;

    await seedAccounts();
    await configureAuths();

    await eosioToken.transfer(
      tokenIssuer.name,
      msigowned.name,
      '100000.0000 TLM',
      'starter blanace.',
      { from: tokenIssuer }
    );

    await shared.initDac(dac_id, '4,MSIGDAC', '1000000.0000 MSIGDAC');
    await shared.getRegMembers(dac_id, '1000.0000 MSIGDAC');
  });
  context('block actions', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.blockaction(eosioToken.account.name, 'close', dac_id, {
            from: owner1,
          })
        );
      });
    });
    context('with correct auth', async () => {
      it('should succeed', async () => {
        await msigworlds.blockaction(eosioToken.account.name, 'close', dac_id, {
          from: msigworlds.account,
        });
      });
    });
    context('add existing action', async () => {
      it('should fail', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.blockaction(eosioToken.account.name, 'close', dac_id, {
            from: msigworlds.account,
          }),
          'action is already blocked for this dac.'
        );
      });
    });
  });
  context('propose', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.propose(
            owner1.name,
            'prop1',
            [
              { actor: owner1.name, permission: 'active' },
              { actor: owner2.name, permission: 'active' },
            ],
            dac_id,
            [],
            {
              actions: [],
              context_free_actions: [],
              delay_sec: '0',
              expiration: await currentHeadTimeWithAddedSeconds(3600),
              max_cpu_usage_ms: 0,
              max_net_usage_words: '0',
              ref_block_num: 12345,
              ref_block_prefix: 123,
              transaction_extensions: [],
            },
            { from: owner2 }
          )
        );
      });
    });

    context('with correct auth', async () => {
      context('from unregistered member', async () => {
        it('should fail with member not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.propose(
              owner1.name,
              'propexp1',
              [
                { actor: owner1.name, permission: 'active' },
                { actor: owner2.name, permission: 'active' },
              ],
              dac_id,
              [],
              {
                actions: [],
                context_free_actions: [],
                delay_sec: '0',
                expiration: await currentHeadTimeWithAddedSeconds(-25 * 3600),
                max_cpu_usage_ms: 0,
                max_net_usage_words: '0',
                ref_block_num: 12345,
                ref_block_prefix: 123,
                transaction_extensions: [],
              },
              { from: owner1 }
            ),
            'ERR::GENERAL_REG_MEMBER_NOT_FOUND'
          );
        });
      });
      context('with registered member in dac', async () => {
        before(async () => {
          await shared.dac_token_contract.memberreg(
            owner1.name,
            shared.configured_dac_memberterms,
            dac_id,
            { from: owner1 }
          );
        });
        context('with passed expiration', async () => {
          it('should fail with expired error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.propose(
                owner1.name,
                'propexp1',
                [
                  { actor: owner1.name, permission: 'active' },
                  { actor: owner2.name, permission: 'active' },
                ],
                dac_id,
                [],
                {
                  actions: [],
                  context_free_actions: [],
                  delay_sec: '0',
                  expiration: await currentHeadTimeWithAddedSeconds(-25 * 3600),
                  max_cpu_usage_ms: 0,
                  max_net_usage_words: '0',
                  ref_block_num: 12345,
                  ref_block_prefix: 123,
                  transaction_extensions: [],
                },
                { from: owner1 }
              ),
              'transaction expired'
            );
          });
        });
        context('with context free actions included', async () => {
          it('should fail with context free actions error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.propose(
                owner1.name,
                'prop1',
                [
                  { actor: owner1.name, permission: 'active' },
                  { actor: owner2.name, permission: 'active' },
                ],
                dac_id,
                [],
                {
                  actions: await api.serializeActions([
                    {
                      account: shared.eosio_token_contract.name,
                      authorization: [
                        { actor: owner1.name, permission: 'active' },
                        { actor: owner2.name, permission: 'active' },
                      ],
                      name: 'transfer',
                      data: {
                        from: owner1.name,
                        to: owner2.name,
                        quantity: '10.0000 TLM',
                        memo: 'testing',
                      },
                    },
                  ]),
                  context_free_actions: await api.serializeActions([
                    {
                      account: shared.eosio_token_contract.name,
                      authorization: [
                        { actor: owner1.name, permission: 'active' },
                        { actor: owner2.name, permission: 'active' },
                      ],
                      name: 'transfer',
                      data: {
                        from: owner1.name,
                        to: owner2.name,
                        quantity: '10.0000 TLM',
                        memo: 'testing',
                      },
                    },
                  ]),
                  delay_sec: '0',
                  expiration: await currentHeadTimeWithAddedSeconds(3600),
                  max_cpu_usage_ms: 0,
                  max_net_usage_words: '0',
                  ref_block_num: 12345,
                  ref_block_prefix: 123,
                  transaction_extensions: [],
                },
                { from: owner1 }
              ),
              'not allowed to `propose` a transaction with context-free actions'
            );
          });
        });
        context('with blocked action', async () => {
          it('should fail with blocked action error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.propose(
                owner1.name,
                'prop1',
                [
                  { actor: owner1.name, permission: 'active' },
                  { actor: owner2.name, permission: 'active' },
                ],
                dac_id,
                [],
                {
                  actions: await api.serializeActions([
                    {
                      account: shared.eosio_token_contract.name,
                      authorization: [
                        { actor: owner1.name, permission: 'active' },
                        { actor: owner2.name, permission: 'active' },
                      ],
                      name: 'transfer',
                      data: {
                        from: owner1.name,
                        to: owner2.name,
                        quantity: '10.0000 TLM',
                        memo: 'testing',
                      },
                    },
                    {
                      account: shared.eosio_token_contract.name,
                      authorization: [
                        { actor: owner1.name, permission: 'active' },
                        { actor: owner2.name, permission: 'active' },
                      ],
                      name: 'close',
                      data: {
                        owner: 'someowner',
                        symbol: '4,EOS',
                      },
                    },
                  ]),
                  context_free_actions: [],
                  delay_sec: '0',
                  expiration: await currentHeadTimeWithAddedSeconds(3600),
                  max_cpu_usage_ms: 0,
                  max_net_usage_words: '0',
                  ref_block_num: 12345,
                  ref_block_prefix: 123,
                  transaction_extensions: [],
                },
                { from: owner1 }
              ),
              'blocked actions'
            );
          });
        });
        context(
          'with all correct params but not being a custodian',
          async () => {
            it('should fail', async () => {
              const result = await assertEOSErrorIncludesMessage(
                msigworlds.propose(
                  owner1.name,
                  'prop1',
                  [
                    { actor: owner1.name, permission: 'active' },
                    { actor: owner2.name, permission: 'active' },
                  ],
                  dac_id,
                  [],
                  {
                    actions: await api.serializeActions([
                      {
                        account: shared.eosio_token_contract.name,
                        authorization: [
                          { actor: owner1.name, permission: 'active' },
                          { actor: owner2.name, permission: 'active' },
                        ],
                        name: 'transfer',
                        data: {
                          from: owner1.name,
                          to: owner2.name,
                          quantity: '10.0000 TLM',
                          memo: 'testing',
                        },
                      },
                    ]),
                    context_free_actions: [],
                    delay_sec: '0',
                    expiration: await currentHeadTimeWithAddedSeconds(3600),
                    max_cpu_usage_ms: 0,
                    max_net_usage_words: '0',
                    ref_block_num: 12345,
                    ref_block_prefix: 123,
                    transaction_extensions: [],
                  },
                  { from: owner1 }
                ),
                'ERR::MUST_BE_CUSTODIAN::'
              );
              // console.log(result);
              // prop1Hash = result.transaction_id; // capture the proposal hash to use for the approve tests.
            });
          }
        );
        context('with all correct params', async () => {
          before(async () => {
            // add user to the custodians table
            await shared.daccustodian_contract.tstaddcust(owner1, dac_id);
          });
          it('should succeed', async () => {
            const result = await msigworlds.propose(
              owner1.name,
              'prop1',
              [
                { actor: owner1.name, permission: 'active' },
                { actor: owner2.name, permission: 'active' },
              ],
              dac_id,
              [],
              {
                actions: await api.serializeActions([
                  {
                    account: shared.eosio_token_contract.name,
                    authorization: [
                      { actor: owner1.name, permission: 'active' },
                      { actor: owner2.name, permission: 'active' },
                    ],
                    name: 'transfer',
                    data: {
                      from: owner1.name,
                      to: owner2.name,
                      quantity: '10.0000 TLM',
                      memo: 'testing',
                    },
                  },
                ]),
                context_free_actions: [],
                delay_sec: '0',
                expiration: await currentHeadTimeWithAddedSeconds(3600),
                max_cpu_usage_ms: 0,
                max_net_usage_words: '0',
                ref_block_num: 12345,
                ref_block_prefix: 123,
                transaction_extensions: [],
              },
              { from: owner1 }
            );
            // console.log(result);
            // prop1Hash = result.transaction_id; // capture the proposal hash to use for the approve tests.
          });
          it('should populate proposals table', async () => {
            const {
              rows: [prop],
            } = await msigworlds.proposalsTable({ scope: dac_id });
            expect(prop.proposer).to.equal(owner1.name);
            expect(prop.state).to.equal(0);
            expect(prop.proposal_name).to.equal('prop1');
            expect(prop.id).to.equal(1);
            modDate = prop.modified_date;
          });
          it('should populate approvals table', async () => {
            const {
              rows: [prop],
            } = await msigworlds.approvalsTable({ scope: dac_id });
            expect(prop.requested_approvals).to.deep.equal([
              {
                level: {
                  actor: 'owner1',
                  permission: 'active',
                },
                time: '1970-01-01T00:00:00.000',
              },
              {
                level: {
                  actor: 'owner2',
                  permission: 'active',
                },
                time: '1970-01-01T00:00:00.000',
              },
            ]);
            expect(prop.provided_approvals).to.be.empty;
            expect(prop.proposal_name).to.equal('prop1');
          });
        });
        context('with existing msig with same name', async () => {
          it('should fail with duplicate name', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.propose(
                owner1.name,
                'prop1',
                [
                  { actor: owner1.name, permission: 'active' },
                  { actor: owner2.name, permission: 'active' },
                ],
                dac_id,
                [],
                {
                  actions: await api.serializeActions([
                    {
                      account: shared.eosio_token_contract.name,
                      authorization: [
                        { actor: owner1.name, permission: 'active' },
                        { actor: owner2.name, permission: 'active' },
                      ],
                      name: 'transfer',
                      data: {
                        from: owner1.name,
                        to: owner2.name,
                        quantity: '11.0000 TLM',
                        memo: 'testing',
                      },
                    },
                  ]),
                  context_free_actions: [],
                  delay_sec: '0',
                  expiration: await currentHeadTimeWithAddedSeconds(3600),
                  max_cpu_usage_ms: 0,
                  max_net_usage_words: '0',
                  ref_block_num: 12345,
                  ref_block_prefix: 123,
                  transaction_extensions: [],
                },
                { from: owner1 }
              ),
              'proposal with the same name exists'
            );
          });
        });
      });
    });
  });
  context('approve', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.approve_object_params(
            {
              proposal_name: 'prop1',
              level: { actor: owner1.name, permission: 'active' },
              dac_id: dac_id,
              proposal_hash: null,
            },
            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.approve(
              'prop11',
              { actor: owner1.name, permission: 'active' },
              dac_id,
              null,
              { from: owner1 }
            ),
            'proposal not found'
          );
        });
      });
    });
    context('with existing proposal', async () => {
      context('for unrequested auth', async () => {
        context('but without being a custodian', async () => {
          it('should fail with PROPOSER_NOT_CUSTODIAN error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.approve(
                'prop1',
                { actor: owner3.name, permission: 'active' },
                dac_id,
                null,
                { from: owner3 }
              ),
              'ERR::MUST_BE_CUSTODIAN::'
            );
          });
        });
        context('while being an active custodian', async () => {
          before(async () => {
            // add user to the custodians table
            await shared.daccustodian_contract.tstaddcust(owner3, dac_id);
          });
          it('should succeed', async () => {
            await msigworlds.approve(
              'prop1',
              { actor: owner3.name, permission: 'active' },
              dac_id,
              null,
              { from: owner3 }
            );
          });
        });
      });
      context('for requested auth', async () => {
        before(async () => {
          // add user to the custodians table
          await shared.daccustodian_contract.tstaddcust(owner2, dac_id);
        });
        it('should succeed', async () => {
          await msigworlds.approve(
            'prop1',
            { actor: owner2.name, permission: 'active' },
            dac_id,
            null,
            { from: owner2 }
          );
        });
        it('should update approvals table', async () => {
          const approvals = await msigworlds.approvalsTable({
            scope: dac_id,
          });
          const matching = approvals.rows[0];

          expect(matching).to.not.be.null;
          expect(matching.proposal_name).to.equal('prop1');
          expect(matching.requested_approvals[0].level.actor).to.equal(
            'owner1'
          );
          expect(matching.requested_approvals[0].time).to.equal(
            '1970-01-01T00:00:00.000'
          );
          expect(matching.provided_approvals[0].level.actor).to.equal('owner3');
          expect(matching.provided_approvals[1].level.actor).to.equal('owner2');
          expect(new Date(matching.provided_approvals[0].time)).to.afterDate(
            new Date('2022-01-01T00:00:00.000')
          );
        });
        it('should update proposal modification date', async () => {
          const props = await msigworlds.proposalsTable({ scope: dac_id });
          expect(props.rows[0].modified_date).to.afterTime(modDate);
          modDate = new Date(props.rows[0].modified_date);
        });
        it('should update proposal earliest exec date', async () => {
          const props = await msigworlds.proposalsTable({ scope: dac_id });
        });
      });
      context('duplicate', async () => {
        it('should fail', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.approve(
              'prop1',
              { actor: owner2.name, permission: 'active' },
              dac_id,
              null,
              { from: owner2 }
            ),
            'ERR::DUPLICATE_APPROVAL::'
          );
        });
      });
    });
  });
  context('unapprove', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.unapprove_object_params(
            {
              proposal_name: 'prop1',
              level: { actor: owner1.name, permission: 'active' },
              dac_id: dac_id,
            },
            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.unapprove(
              'prop11',
              { actor: owner1.name, permission: 'active' },
              dac_id,
              { from: owner1 }
            ),
            'ERR::NO_APPROVALS_FOUND'
          );
        });
      });
    });
    context('with correct auth', async () => {
      context('with existing proposal', async () => {
        context('for previously unapproved auth', async () => {
          it('should fail with approval not on list found error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.unapprove(
                'prop1',
                { actor: owner1.name, permission: 'active' },
                dac_id,
                { from: owner1 }
              ),
              'no approval previously granted'
            );
          });
        });
        context('for previously granted approval auth', async () => {
          it('should succeed', async () => {
            await msigworlds.unapprove(
              'prop1',
              { actor: owner2.name, permission: 'active' },
              dac_id,
              { from: owner2 }
            );
          });
          it('should update approvals table', async () => {
            const approvals = await msigworlds.approvalsTable({
              scope: dac_id,
            });
            const matching = approvals.rows[0];

            expect(matching).to.not.be.null;
            expect(matching.proposal_name).to.equal('prop1');
            expect(matching.requested_approvals[0].level.actor).to.equal(
              'owner1'
            );
            expect(matching.requested_approvals[0].time).to.equal(
              '1970-01-01T00:00:00.000'
            );
            expect(matching.provided_approvals.length).to.equal(1);
            expect(matching.requested_approvals[1].level.actor).to.equal(
              'owner2'
            );
            expect(new Date(matching.requested_approvals[1].time)).to.afterDate(
              new Date('2022-01-01T00:00:00.000')
            );
          });
          it('should update proposal modification date', async () => {
            const props = await msigworlds.proposalsTable({ scope: dac_id });
            expect(props.rows[0].modified_date).to.afterTime(modDate);
            expect(props.rows[0].earliest_exec_time).to.be.null;
            expect(props.rows[0].state).to.equal(0);
          });
        });
      });
    });
  });
  context('deny', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.deny_object_params(
            {
              proposal_name: 'prop1',
              level: { actor: owner1.name, permission: 'active' },
              dac_id: dac_id,
            },
            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.deny(
              'prop11',
              { actor: owner1.name, permission: 'active' },
              dac_id,
              { from: owner1 }
            ),
            'ERR::NO_APPROVALS_FOUND'
          );
        });
      });
    });
    context('with correct auth', async () => {
      context('with existing proposal', async () => {
        context('for previously denied auth', async () => {
          it('should work', async () => {
            await msigworlds.deny(
              'prop1',
              { actor: owner3.name, permission: 'active' },
              dac_id,
              { from: owner3 }
            );
          });
        });
        context('for previously granted approval auth', async () => {
          it('should succeed', async () => {
            await msigworlds.deny(
              'prop1',
              { actor: owner2.name, permission: 'active' },
              dac_id,
              { from: owner2 }
            );
          });
          it('should update approvals table', async () => {
            const approvals = await msigworlds.approvalsTable({
              scope: dac_id,
            });
            const matching = approvals.rows[0];

            expect(matching).to.not.be.null;
            expect(matching.proposal_name).to.equal('prop1');
            expect(matching.requested_approvals[0].level.actor).to.equal(
              'owner1'
            );
            expect(matching.requested_approvals[0].time).to.equal(
              '1970-01-01T00:00:00.000'
            );
            expect(matching.provided_approvals).to.empty;
            expect(matching.requested_approvals[1].level.actor).to.equal(
              'owner2'
            );
            expect(new Date(matching.requested_approvals[1].time)).to.afterDate(
              new Date('2022-01-01T00:00:00.000')
            );
          });
          it('should update proposal modification date', async () => {
            const props = await msigworlds.proposalsTable({ scope: dac_id });
            expect(props.rows[0].modified_date).to.afterTime(modDate);
            expect(props.rows[0].earliest_exec_time).to.be.null;
            expect(props.rows[0].state).to.equal(0);
          });
        });
      });
    });
  });
  context('cancel', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.cancel(
            'prop1',
            owner1.name,
            dac_id,

            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.cancel('prop11', owner1.name, dac_id, {
              from: owner1,
            }),
            'proposal not found'
          );
        });
      });
    });
    context('with correct auth', async () => {
      context('with existing proposal', async () => {
        context('for proposal from different creator auth', async () => {
          it('should fail with approval not on list found error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.cancel('prop1', owner3.name, dac_id, {
                from: owner3,
              }),
              'cannot cancel until expiration'
            );
          });
        });
        context('when cancelor is the proposer', async () => {
          it('should succeed', async () => {
            await msigworlds.cancel('prop1', owner1.name, dac_id, {
              from: owner1,
            });
          });
          it('should update approvals table', async () => {
            const approvals = await msigworlds.approvalsTable({
              scope: dac_id,
            });
            const matching = approvals.rows[0];

            expect(matching).to.not.be.null;
            expect(matching.proposal_name).to.equal('prop1');
            expect(matching.requested_approvals[0].level.actor).to.equal(
              'owner1'
            );
            expect(matching.requested_approvals[0].time).to.equal(
              '1970-01-01T00:00:00.000'
            );
            expect(matching.provided_approvals).to.empty;
            expect(matching.requested_approvals[1].level.actor).to.equal(
              'owner2'
            );
            expect(new Date(matching.requested_approvals[1].time)).to.afterDate(
              new Date('2022-01-01T00:00:00.000')
            );
          });
          it('should update proposal modification date', async () => {
            const props = await msigworlds.proposalsTable({ scope: dac_id });
            expect(props.rows[0].modified_date).to.afterTime(modDate);
            expect(props.rows[0].earliest_exec_time).to.be.null;
            expect(props.rows[0].state).to.equal(2);
          });
        });
        context('after proposal has already been cancelled', async () => {
          it('should fail with state error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.cancel('prop1', owner1.name, dac_id, {
                from: owner1,
              }),
              'ERR::PROP_NOT_PENDING'
            );
          });
        });
      });
    });
  });
  context('exec', async () => {
    before(async () => {
      await msigworlds.propose(
        owner1.name,
        'prop2',
        [
          { actor: owner1.name, permission: 'active' },
          { actor: owner2.name, permission: 'active' },
        ],
        dac_id,
        [],
        {
          actions: await api.serializeActions([
            {
              account: shared.eosio_token_contract.name,
              authorization: [
                { actor: owner1.name, permission: 'active' },
                { actor: owner2.name, permission: 'active' },
              ],
              name: 'transfer',
              data: {
                from: owner1.name,
                to: owner2.name,
                quantity: '10.0000 TLM',
                memo: 'testing',
              },
            },
          ]),
          context_free_actions: [],
          delay_sec: '0',
          expiration: await currentHeadTimeWithAddedSeconds(3600),
          max_cpu_usage_ms: 0,
          max_net_usage_words: '0',
          ref_block_num: 12345,
          ref_block_prefix: 123,
          transaction_extensions: [],
        },
        { from: owner1 }
      );
    });
    it('prop2 should have the correct id', async () => {
      const res = await msigworlds.proposalsTable({
        scope: dac_id,
        lowerBound: 'prop2',
        upperBound: 'prop2',
      });
      const prop = res.rows[0];
      expect(prop.proposal_name).to.equal('prop2');
      expect(prop.id).to.equal(2);
    });
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.exec(
            'prop2',
            owner1.name,
            dac_id,

            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.exec('prop11', owner1.name, dac_id, {
              from: owner1,
            }),
            'proposal not found'
          );
        });
      });

      context('for proposal from that is already cancelled', async () => {
        it('should fail with proposal not in pending state.', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.exec('prop1', owner3.name, dac_id, {
              from: owner3,
            }),
            'ERR::PROP_EXEC_NOT_PENDING'
          );
        });
      });
    });

    context('without sufficient auth to approve', async () => {
      it('should fail with transaction auth error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.exec('prop2', owner1.name, dac_id, {
            from: owner1,
          }),
          'transaction authorization failed'
        );
      });
    });

    context('with expired transaction', async () => {
      before(async () => {
        await msigworlds.propose(
          owner1.name,
          'propexp',
          [
            { actor: owner1.name, permission: 'active' },
            { actor: owner2.name, permission: 'active' },
          ],
          dac_id,
          [],
          {
            actions: await api.serializeActions([
              {
                account: shared.eosio_token_contract.name,
                authorization: [
                  { actor: owner1.name, permission: 'active' },
                  { actor: owner2.name, permission: 'active' },
                ],
                name: 'transfer',
                data: {
                  from: owner1.name,
                  to: owner2.name,
                  quantity: '10.0000 TLM',
                  memo: 'testing',
                },
              },
            ]),
            context_free_actions: [],
            delay_sec: '0',
            expiration: await currentHeadTimeWithAddedSeconds(1),
            max_cpu_usage_ms: 0,
            max_net_usage_words: '0',
            ref_block_num: 12345,
            ref_block_prefix: 123,
            transaction_extensions: [],
          },
          { from: owner1 }
        );
        await sleep(2001);
      });
      it('propexp should have the correct id', async () => {
        const res = await msigworlds.proposalsTable({
          scope: dac_id,
          lowerBound: 'propexp',
          upperBound: 'propexp',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propexp');
        expect(prop.id).to.equal(3);
      });
      it('should fail with expired error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.exec('propexp', owner1.name, dac_id, {
            from: owner1,
          }),
          'transaction expired'
        );
      });
    });

    context('with sufficient auth for transaction', async () => {
      before(async () => {
        await msigworlds.propose(
          owner1.name,
          'propgood',
          [
            { actor: owner1.name, permission: 'active' },
            { actor: owner2.name, permission: 'active' },
          ],
          dac_id,
          [],
          {
            actions: await api.serializeActions([
              {
                account: shared.eosio_token_contract.name,
                authorization: [
                  { actor: msigowned.name, permission: 'active' },
                ],
                name: 'transfer',
                data: {
                  from: msigowned.name,
                  to: owner2.name,
                  quantity: '10.0000 TLM',
                  memo: 'testing',
                },
              },
            ]),
            context_free_actions: [],
            delay_sec: '0',
            expiration: await currentHeadTimeWithAddedSeconds(10),
            max_cpu_usage_ms: 0,
            max_net_usage_words: '0',
            ref_block_num: 12345,
            ref_block_prefix: 123,
            transaction_extensions: [],
          },
          { from: owner1 }
        );

        await msigworlds.approve(
          'propgood',
          { actor: owner1.name, permission: 'active' },
          dac_id,
          null,
          { from: owner1 }
        );

        await msigworlds.approve(
          'propgood',
          { actor: owner2.name, permission: 'active' },
          dac_id,
          null,
          { from: owner2 }
        );
      });
      it('should succeed', async () => {
        await msigworlds.exec('propgood', owner1.name, dac_id, {
          from: owner1,
        });
      });
      it('propgood should have the correct id', async () => {
        const res = await msigworlds.proposalsTable({
          scope: dac_id,
          lowerBound: 'propgood',
          upperBound: 'propgood',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propgood');
        expect(prop.id).to.equal(4);
      });

      it('should update approvals table', async () => {
        const approvals = await msigworlds.approvalsTable({
          scope: dac_id,
        });
        const matching = approvals.rows[0];

        expect(matching).to.not.be.null;
        expect(matching.proposal_name).to.equal('prop1');
        expect(matching.requested_approvals[0].level.actor).to.equal('owner1');
        expect(matching.requested_approvals[0].time).to.equal(
          '1970-01-01T00:00:00.000'
        );
        expect(matching.provided_approvals).to.empty;
        expect(matching.requested_approvals[1].level.actor).to.equal('owner2');
        expect(new Date(matching.requested_approvals[1].time)).to.afterDate(
          new Date('2022-01-01T00:00:00.000')
        );
      });
      it('should update proposal modification date', async () => {
        const props = await msigworlds.proposalsTable({ scope: dac_id });
        expect(props.rows[0].modified_date).to.afterTime(modDate);
        expect(props.rows[0].earliest_exec_time).to.be.null;
        expect(props.rows[0].state).to.equal(2);
      });
    });
    context('after proposal has already been executed', async () => {
      it('should fail with state error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.exec('propgood', owner1.name, dac_id, {
            from: owner1,
          }),
          'ERR::PROP_EXEC_NOT_PENDING'
        );
      });
    });
  });
  context('cleanup', async () => {
    context('with non exisitant proposal', async () => {
      it('should fail with not found error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.cleanup('fakeprop', dac_id),
          'PROPOSAL_NOT_FOUND'
        );
      });
    });
    context('before being executed or cancelled', async () => {
      before(async () => {
        await msigworlds.propose(
          owner1.name,
          'propclean',
          [
            { actor: owner1.name, permission: 'active' },
            { actor: owner2.name, permission: 'active' },
          ],
          dac_id,
          [],
          {
            actions: await api.serializeActions([
              {
                account: shared.eosio_token_contract.name,
                authorization: [
                  { actor: msigowned.name, permission: 'active' },
                ],
                name: 'transfer',
                data: {
                  from: msigowned.name,
                  to: owner2.name,
                  quantity: '10.0000 TLM',
                  memo: 'testing',
                },
              },
            ]),
            context_free_actions: [],
            delay_sec: '0',
            expiration: await currentHeadTimeWithAddedSeconds(10),
            max_cpu_usage_ms: 0,
            max_net_usage_words: '0',
            ref_block_num: 12345,
            ref_block_prefix: 123,
            transaction_extensions: [],
          },
          { from: owner1 }
        );

        await msigworlds.approve(
          'propclean',
          { actor: owner1.name, permission: 'active' },
          dac_id,
          null,
          { from: owner1 }
        );

        await msigworlds.approve(
          'propclean',
          { actor: owner2.name, permission: 'active' },
          dac_id,
          null,
          { from: owner2 }
        );
      });
      it('propclean should have the correct id', async () => {
        const res = await msigworlds.proposalsTable({
          scope: dac_id,
          lowerBound: 'propclean',
          upperBound: 'propclean',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propclean');
        expect(prop.id).to.equal(5);
      });
      it('shoul fail with wrong state error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.cleanup('propclean', dac_id),
          'ERR::PROPOSAL_CLEANUP_STILL_PENDING'
        );
      });
    });
    context('with completed proposal', async () => {
      it('should succeed', async () => {
        await msigworlds.cleanup('propgood', dac_id);
      });
      it('should erase the proposals and approvals record', async () => {
        await assertRowCount(
          msigworlds.proposalsTable({ scope: dac_id, lowerBound: 'propgood' }),
          0
        );
        await assertRowCount(
          msigworlds.approvalsTable({ scope: dac_id, lowerBound: 'propgood' }),
          0
        );
      });
    });
  });

  // A union dac has no custodians of its own. Its proposals are approved by the custodians of its
  // member dacs, and the threshold - 4 of the 6 member dacs, each of which is itself 3 of 5 - is
  // expressed in the union account's permission rather than in this contract. These tests live at
  // the end of the file because they register further dacs in the directory; nothing above them
  // depends on those.
  context('union dac', async () => {
    // These must match UNION_DACS in msigworlds.hpp exactly - the membership is compiled into the
    // contract, so the test has to stand up the same dacs rather than register its own.
    const union_dac_id = 'synthar';
    const member_dac_ids = [
      'eyekeunn',
      'kavianunn',
      'magorunn',
      'naronunn',
      'neriunn',
      'velesunn',
    ];
    const UNION_THRESHOLD = 4;
    const MEMBER_THRESHOLD = 3;
    const MEMBER_CUSTODIAN_COUNT = 5;

    // The account the union's proposed transactions are authorised by, and the account that
    // proposes them. Registered as the union's MSIGOWNED account.
    let unionOwned: Account;
    // One account per member dac standing in for that dac's dacauthority account.
    let daoAuths: Account[] = [];
    // daoCustodians[i] are the five custodians of member dac i.
    let daoCustodians: Account[][] = [];
    // A registered member of member dac one, and so a valid proposer for the union.
    let unionProposer: Account;

    // The directory allows one dac per owner, so each dac registered here brings its own owner
    // account rather than reusing the shared auth account.
    const registerDac = async (
      owner: Account,
      dacId: string,
      symbolCode: string,
      accounts: { key: number; value: string }[]
    ) =>
      shared.dacdirectory_contract.regdac(
        owner.name,
        dacId,
        {
          contract: shared.dac_token_contract.account.name,
          sym: `4,${symbolCode}`,
        },
        'union_test_dac',
        [],
        accounts,
        { from: owner }
      );

    // eosio rejects an authority whose accounts are not sorted by (actor, permission).
    const sortedWeights = (
      weights: { permission: { actor: string; permission: string }; weight: number }[]
    ) =>
      [...weights].sort((a, b) =>
        a.permission.actor < b.permission.actor ? -1 : 1
      );

    const setThresholdAuth = async (
      account: Account,
      threshold: number,
      members: { actor: string; permission: string }[]
    ) =>
      UpdateAuth.execUpdateAuth(
        [{ actor: account.name, permission: 'owner' }],
        account.name,
        'active',
        'owner',
        UpdateAuth.AuthorityToSet.explicitAuthorities(
          threshold,
          sortedWeights([
            // msigworlds needs full weight or exec's inline dispatch fails even once the
            // approvals are in. This mirrors daccustodian's add_auth_to_account.
            {
              permission: {
                actor: msigworlds.account.name,
                permission: 'active',
              },
              weight: threshold,
            },
            ...members.map((m) => ({ permission: m, weight: 1 })),
          ]),
          [],
          []
        )
      );

    const unionTransaction = async (expirySeconds: number = 3600) => ({
      actions: await api.serializeActions([
        {
          account: shared.eosio_token_contract.name,
          authorization: [{ actor: unionOwned.name, permission: 'active' }],
          name: 'transfer',
          data: {
            from: unionOwned.name,
            to: owner2.name,
            quantity: '1.0000 TLM',
            memo: 'union spend',
          },
        },
      ]),
      context_free_actions: [] as any[],
      delay_sec: '0',
      expiration: await currentHeadTimeWithAddedSeconds(expirySeconds),
      max_cpu_usage_ms: 0,
      max_net_usage_words: '0',
      ref_block_num: 12345,
      ref_block_prefix: 123,
      transaction_extensions: [] as any[],
    });

    // Approve from member dacs [firstDac, lastDac), using exactly `custodianCount` custodians of
    // each - by default the member threshold, so that each dac sits exactly on its own bar and a
    // single withdrawn approval drops it below.
    const approveFromDacs = async (
      proposalName: string,
      firstDac: number,
      lastDac: number,
      custodianCount: number = MEMBER_THRESHOLD
    ) => {
      for (let i = firstDac; i < lastDac; i++) {
        for (const custodian of daoCustodians[i].slice(0, custodianCount)) {
          await msigworlds.approve(
            proposalName,
            { actor: custodian.name, permission: 'active' },
            union_dac_id,
            null,
            { from: custodian }
          );
        }
      }
    };

    // checkauth always throws; the message is the result. Returned as an exact verdict because
    // 'Approved' is a substring of 'Unapproved' and an include() assertion cannot tell them apart.
    const checkauthVerdict = async (proposalName: string) => {
      try {
        await msigworlds.checkauth(proposalName, union_dac_id);
        return 'did not throw';
      } catch (e) {
        const message = JSON.stringify(e);
        if (message.includes('Unapproved')) return 'Unapproved';
        if (message.includes('Approved')) return 'Approved';
        return message;
      }
    };

    before(async () => {
      unionOwned = await AccountManager.createAccount('syntharown');

      for (let i = 0; i < member_dac_ids.length; i++) {
        // Lettered for the same reason as the dac ids above.
        const dacLetter = 'abcdef'[i];
        daoAuths.push(await AccountManager.createAccount(`udauth${dacLetter}`));
        const custodians: Account[] = [];
        for (let c = 0; c < MEMBER_CUSTODIAN_COUNT; c++) {
          custodians.push(
            await AccountManager.createAccount(`ud${dacLetter}cust${'abcde'[c]}`)
          );
        }
        daoCustodians.push(custodians);

        // Symbol codes are A-Z only, so the member dacs are lettered rather than numbered.
        // Each member dac is owned by the account standing in for its dacauthority.
        await registerDac(
          daoAuths[i],
          member_dac_ids[i],
          `UNIOND${String.fromCharCode(65 + i)}`,
          []
        );

        // Member terms, and one registered member, so that the union has a valid proposer. Done
        // while the owner can still sign for itself, before its auth becomes the 3 of 5 below.
        await shared.setup_dac_memberterms(member_dac_ids[i], daoAuths[i]);
        await shared.dac_token_contract.memberreg(
          custodians[0].name,
          shared.configured_dac_memberterms,
          member_dac_ids[i],
          { from: custodians[0] }
        );

        // Each member dac is 3 of 5, as the real dacs are today.
        await setThresholdAuth(
          daoAuths[i],
          MEMBER_THRESHOLD,
          custodians.map((c) => ({ actor: c.name, permission: 'active' }))
        );
      }

      // The union dac is registered with an MSIGOWNED account and deliberately no CUSTODIAN
      // account, which is what lets custodians of the member dacs approve its proposals.
      await registerDac(unionOwned, union_dac_id, 'SYNTHAR', [
        { key: Account_type.MSIGOWNED, value: unionOwned.name },
      ]);

      await setThresholdAuth(
        unionOwned,
        UNION_THRESHOLD,
        daoAuths.map((d) => ({ actor: d.name, permission: 'active' }))
      );

      unionProposer = daoCustodians[0][0];

      await eosioToken.transfer(
        tokenIssuer.name,
        unionOwned.name,
        '100.0000 TLM',
        'union balance',
        { from: tokenIssuer }
      );
    });

    context('propose for the union', async () => {
      // The union has no token and therefore no member register of its own, so a proposer
      // qualifies by being a registered member of one of the member dacs.
      it('should succeed from a member of a member dac', async () => {
        await msigworlds.propose(
          unionProposer.name,
          'unionprop1',
          [{ actor: unionOwned.name, permission: 'active' }],
          union_dac_id,
          [],
          await unionTransaction(),
          { from: unionProposer }
        );
      });
      it('should refuse a proposer that is a member of no member dac', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.propose(
            owner3.name,
            'unionprop2',
            [{ actor: unionOwned.name, permission: 'active' }],
            union_dac_id,
            [],
            await unionTransaction(),
            { from: owner3 }
          ),
          'ERR::MUST_BE_UNION_MEMBER'
        );
      });
    });

    context('approving to the union threshold', async () => {
      context('with three of the six member dacs approving', async () => {
        before(async () => {
          await approveFromDacs('unionprop1', 0, 3);
        });
        it('should not be authorised', async () => {
          expect(await checkauthVerdict('unionprop1')).to.equal('Unapproved');
        });
        it('should fail to execute', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.exec('unionprop1', unionProposer.name, union_dac_id, {
              from: unionProposer,
            }),
            'transaction authorization failed'
          );
        });
      });
      context('with a fourth member dac approving', async () => {
        before(async () => {
          // only the fourth dac; the first three have already approved.
          await approveFromDacs('unionprop1', 3, 4);
        });
        it('should be authorised', async () => {
          expect(await checkauthVerdict('unionprop1')).to.equal('Approved');
        });
        it('should execute', async () => {
          await msigworlds.exec('unionprop1', unionProposer.name, union_dac_id, {
            from: unionProposer,
          });
        });
      });
    });

    context('with only two custodians of a member dac approving', async () => {
      before(async () => {
        await msigworlds.propose(
          unionProposer.name,
          'unionprop3',
          [{ actor: unionOwned.name, permission: 'active' }],
          union_dac_id,
          [],
          await unionTransaction(),
          { from: unionProposer }
        );
        // Three dacs in full, then two custodians only of the fourth.
        await approveFromDacs('unionprop3', 0, 3);
        // Two custodians only of the fourth dac, one short of its own threshold.
        await approveFromDacs('unionprop3', 3, 4, MEMBER_THRESHOLD - 1);
      });
      it('should not count that dac towards the union threshold', async () => {
        expect(await checkauthVerdict('unionprop3')).to.equal('Unapproved');
      });
    });

    context('invalidate in a member dac scope', async () => {
      // The custodian's own dac is where they would sensibly invalidate a compromised key. Before
      // the union member registry this had no effect on the union's proposals and their stale
      // approvals kept counting.
      before(async () => {
        await msigworlds.propose(
          unionProposer.name,
          'unionprop4',
          [{ actor: unionOwned.name, permission: 'active' }],
          union_dac_id,
          [],
          await unionTransaction(),
          { from: unionProposer }
        );
        await approveFromDacs('unionprop4', 0, 4);
      });
      it('should be authorised before the invalidation', async () => {
        expect(await checkauthVerdict('unionprop4')).to.equal('Approved');
      });
      context('once a custodian invalidates in their own dac', async () => {
        before(async () => {
          const custodian = daoCustodians[0][0];
          await msigworlds.invalidate(custodian.name, member_dac_ids[0], {
            from: custodian,
          });
        });
        it('should drop that dac below its own threshold and the union below four', async () => {
          expect(await checkauthVerdict('unionprop4')).to.equal('Unapproved');
        });
      });
    });

    context('an action blocked by a member dac', async () => {
      before(async () => {
        await msigworlds.blockaction(
          shared.eosio_token_contract.name,
          'transfer',
          member_dac_ids[4],
          { from: msigworlds.account }
        );
      });
      after(async () => {
        // Leave the member dac's blocklist as it was so later contexts are unaffected.
        await assertRowCount(
          msigworlds.blockedactnsTable({ scope: member_dac_ids[4] }),
          1
        );
      });
      it('should be refused when proposed in the union scope', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.propose(
            unionProposer.name,
            'unionprop5',
            [{ actor: unionOwned.name, permission: 'active' }],
            union_dac_id,
            [],
            await unionTransaction(),
            { from: unionProposer }
          ),
          'proposal contains some blocked actions.'
        );
      });
    });
  });

  // A union may list fewer than MAX_UNION_MEMBERS members; the empty trailing entries must be
  // skipped rather than read as dac_id 0. These ids must match the second UNION_DACS entry in
  // msigworlds.hpp.
  context('single member union dac', async () => {
    const union_dac_id = 'testaunn';
    const member_dac_id = 'testa';
    let soleOwned: Account;
    let soleAuth: Account;
    let soleCustodians: Account[] = [];
    let soleProposer: Account;

    before(async () => {
      soleOwned = await AccountManager.createAccount('testaunnownd');
      soleAuth = await AccountManager.createAccount('testaunnauth');
      for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
        soleCustodians.push(
          await AccountManager.createAccount(`tacust${suffix}`)
        );
      }

      await shared.dacdirectory_contract.regdac(
        soleAuth.name,
        member_dac_id,
        {
          contract: shared.dac_token_contract.account.name,
          sym: '4,TESTAX',
        },
        'union_test_dac',
        [],
        [],
        { from: soleAuth }
      );
      await shared.setup_dac_memberterms(member_dac_id, soleAuth);
      await shared.dac_token_contract.memberreg(
        soleCustodians[0].name,
        shared.configured_dac_memberterms,
        member_dac_id,
        { from: soleCustodians[0] }
      );
      soleProposer = soleCustodians[0];

      // The member dac is 3 of 5, as testa is on chain.
      await UpdateAuth.execUpdateAuth(
        [{ actor: soleAuth.name, permission: 'owner' }],
        soleAuth.name,
        'active',
        'owner',
        UpdateAuth.AuthorityToSet.explicitAuthorities(
          3,
          [
            {
              permission: {
                actor: msigworlds.account.name,
                permission: 'active',
              },
              weight: 3,
            },
            ...soleCustodians.map((c) => ({
              permission: { actor: c.name, permission: 'active' },
              weight: 1,
            })),
          ].sort((a, b) =>
            a.permission.actor < b.permission.actor ? -1 : 1
          ),
          [],
          []
        )
      );

      // The union is 1 of 1 over its only member.
      await UpdateAuth.execUpdateAuth(
        [{ actor: soleOwned.name, permission: 'owner' }],
        soleOwned.name,
        'active',
        'owner',
        UpdateAuth.AuthorityToSet.explicitAuthorities(
          1,
          [
            {
              permission: {
                actor: msigworlds.account.name,
                permission: 'active',
              },
              weight: 1,
            },
            { permission: { actor: soleAuth.name, permission: 'active' }, weight: 1 },
          ].sort((a, b) =>
            a.permission.actor < b.permission.actor ? -1 : 1
          ),
          [],
          []
        )
      );

      await shared.dacdirectory_contract.regdac(
        soleOwned.name,
        union_dac_id,
        {
          contract: shared.dac_token_contract.account.name,
          sym: '4,TESTAUN',
        },
        'union_test_dac',
        [],
        [{ key: Account_type.MSIGOWNED, value: soleOwned.name }],
        { from: soleOwned }
      );

      await eosioToken.transfer(
        tokenIssuer.name,
        soleOwned.name,
        '10.0000 TLM',
        'sole union balance',
        { from: tokenIssuer }
      );
    });

    it('should accept a proposer who is a member of its only member dac', async () => {
      await msigworlds.propose(
        soleProposer.name,
        'soleprop1',
        [{ actor: soleOwned.name, permission: 'active' }],
        union_dac_id,
        [],
        {
          actions: await api.serializeActions([
            {
              account: shared.eosio_token_contract.name,
              authorization: [
                { actor: soleOwned.name, permission: 'active' },
              ],
              name: 'transfer',
              data: {
                from: soleOwned.name,
                to: owner2.name,
                quantity: '1.0000 TLM',
                memo: 'sole union spend',
              },
            },
          ]),
          context_free_actions: [] as any[],
          delay_sec: '0',
          expiration: await currentHeadTimeWithAddedSeconds(3600),
          max_cpu_usage_ms: 0,
          max_net_usage_words: '0',
          ref_block_num: 12345,
          ref_block_prefix: 123,
          transaction_extensions: [] as any[],
        },
        { from: soleProposer }
      );
    });

    it('should refuse a proposer who is a member of no member dac', async () => {
      await assertEOSErrorIncludesMessage(
        msigworlds.propose(
          owner3.name,
          'soleprop2',
          [{ actor: soleOwned.name, permission: 'active' }],
          union_dac_id,
          [],
          {
            actions: await api.serializeActions([
              {
                account: shared.eosio_token_contract.name,
                authorization: [
                  { actor: soleOwned.name, permission: 'active' },
                ],
                name: 'transfer',
                data: {
                  from: soleOwned.name,
                  to: owner2.name,
                  quantity: '1.0000 TLM',
                  memo: 'sole union spend',
                },
              },
            ]),
            context_free_actions: [] as any[],
            delay_sec: '0',
            expiration: await currentHeadTimeWithAddedSeconds(3600),
            max_cpu_usage_ms: 0,
            max_net_usage_words: '0',
            ref_block_num: 12345,
            ref_block_prefix: 123,
            transaction_extensions: [] as any[],
          },
          { from: owner3 }
        ),
        'ERR::MUST_BE_UNION_MEMBER'
      );
    });

    it('should execute once the only member dac reaches its own threshold', async () => {
      for (const custodian of soleCustodians.slice(0, 3)) {
        await msigworlds.approve(
          'soleprop1',
          { actor: custodian.name, permission: 'active' },
          union_dac_id,
          null,
          { from: custodian }
        );
      }
      await msigworlds.exec('soleprop1', soleProposer.name, union_dac_id, {
        from: soleProposer,
      });
    });
  });
});

async function configureAuths() {
  await UpdateAuth.execUpdateAuth(
    [{ actor: msigowned.name, permission: 'owner' }],
    msigowned.name,
    'active',
    'owner',
    UpdateAuth.AuthorityToSet.explicitAuthorities(
      3,
      [
        {
          permission: {
            actor: msigworlds.account.name,
            permission: 'active',
          },
          weight: 3,
        },
        { permission: { actor: owner1.name, permission: 'active' }, weight: 2 },
        { permission: { actor: owner2.name, permission: 'active' }, weight: 1 },
      ],
      [
        //   {
        //     key: owner1.publicKey,
        //     weight: 2,
        //   },
        //   {
        //     key: owner2.publicKey,
        //     weight: 1,
        //   },
        // ].sort((a, b) => {
        //   // ensure keys are sorted alphabetically to avoid invalid auth error.
        //   return a.key < b.key ? -1 : 1;
        // }),
      ],
      []
    )
  );
}

async function seedAccounts() {
  owner1 = await AccountManager.createAccount('owner1');
  owner2 = await AccountManager.createAccount('owner2');
  owner3 = await AccountManager.createAccount('owner3');
  msigowned = await AccountManager.createAccount('msigowned');

  await eosioToken.transfer(
    tokenIssuer.name,
    msigworlds.account.name,
    '0.1000 TLM',
    'inital balance',
    { from: tokenIssuer }
  );
}
