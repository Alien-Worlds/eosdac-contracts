import {
  ContractDeployer,
  AccountManager,
  Account,
  UpdateAuth,
  assertEOSErrorIncludesMessage,
  assertMissingAuthority,
  EOSManager,
  sleep,
  debugPromise,
  assertRowsEqualStrict,
  assertRowCount,
} from 'lamington';
import { SharedTestObjects } from '../TestHelpers';

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

export const currentHeadTimeWithAddedSeconds = async (seconds: number) => {
  const { head_block_time } = await EOSManager.api.rpc.get_info();
  const date = new Date(new Date(head_block_time).getTime() + seconds * 1000);
  return date;
};

describe('msigworlds', () => {
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
  });
  context('block actions', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.blockaction(eosioToken.account.name, 'close', 'dac1', {
            from: owner1,
          })
        );
      });
    });
    context('with correct auth', async () => {
      it('should succeed', async () => {
        await msigworlds.blockaction(eosioToken.account.name, 'close', 'dac1', {
          from: msigworlds.account,
        });
      });
    });
    context('add existing action', async () => {
      it('should fail', async () => {
        await sleep(1000); // to avoid duplicate tx id
        await assertEOSErrorIncludesMessage(
          msigworlds.blockaction(eosioToken.account.name, 'close', 'dac1', {
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
            'dac1',
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
              'dac1',
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
              'dac1',
              [],
              {
                actions: await api.serializeActions([
                  {
                    account: 'alienworlds',
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
                    account: 'alienworlds',
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
              'dac1',
              [],
              {
                actions: await api.serializeActions([
                  {
                    account: 'alienworlds',
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
                    account: 'alienworlds',
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
      context('with all correct params', async () => {
        it('should succeed', async () => {
          const result = await msigworlds.propose(
            owner1.name,
            'prop1',
            [
              { actor: owner1.name, permission: 'active' },
              { actor: owner2.name, permission: 'active' },
            ],
            'dac1',
            [],
            {
              actions: await api.serializeActions([
                {
                  account: 'alienworlds',
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
          } = await msigworlds.proposalsTable({ scope: 'dac1' });
          expect(prop.proposer).to.equal(owner1.name);
          expect(prop.state).to.equal(0);
          expect(prop.proposal_name).to.equal('prop1');
          expect(prop.id).to.equal(1);
          modDate = prop.modified_date;
        });
        it('should populate approvals table', async () => {
          const {
            rows: [prop],
          } = await msigworlds.approvalsTable({ scope: 'dac1' });
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
              'dac1',
              [],
              {
                actions: await api.serializeActions([
                  {
                    account: 'alienworlds',
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
  context('approve', async () => {
    context('with wrong auth', async () => {
      it('should fail with auth error', async () => {
        await assertMissingAuthority(
          msigworlds.approve_object_params(
            {
              proposal_name: 'prop1',
              level: { actor: owner1.name, permission: 'active' },
              dac_id: 'dac1',
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
              'dac1',
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
        it('should fail with approval not on list found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.approve(
              'prop1',
              { actor: owner3.name, permission: 'active' },
              'dac1',
              null,
              { from: owner3 }
            ),
            'approval is not on the list of requested approvals'
          );
        });
      });
      context('for requested auth', async () => {
        it('should succeed', async () => {
          await msigworlds.approve(
            'prop1',
            { actor: owner2.name, permission: 'active' },
            'dac1',
            null,
            { from: owner2 }
          );
        });
        it('should update approvals table', async () => {
          const approvals = await msigworlds.approvalsTable({
            scope: 'dac1',
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
          expect(matching.provided_approvals[0].level.actor).to.equal('owner2');
          expect(new Date(matching.provided_approvals[0].time)).to.afterDate(
            new Date('2022-01-01T00:00:00.000')
          );
        });
        it('should update proposal modification date', async () => {
          const props = await msigworlds.proposalsTable({ scope: 'dac1' });
          expect(props.rows[0].modified_date).to.afterTime(modDate);
          modDate = new Date(props.rows[0].modified_date);
        });
        it('should update proposal earliest exec date', async () => {
          const props = await msigworlds.proposalsTable({ scope: 'dac1' });
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
              dac_id: 'dac1',
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
              'dac1',
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
                { actor: owner3.name, permission: 'active' },
                'dac1',
                { from: owner3 }
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
              'dac1',
              { from: owner2 }
            );
          });
          it('should update approvals table', async () => {
            const approvals = await msigworlds.approvalsTable({
              scope: 'dac1',
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
            const props = await msigworlds.proposalsTable({ scope: 'dac1' });
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
            'dac1',

            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.cancel('prop11', owner1.name, 'dac1', {
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
              msigworlds.cancel('prop1', owner3.name, 'dac1', {
                from: owner3,
              }),
              'cannot cancel until expiration'
            );
          });
        });
        context('when cancelor is the proposer', async () => {
          it('should succeed', async () => {
            await msigworlds.cancel('prop1', owner1.name, 'dac1', {
              from: owner1,
            });
          });
          it('should update approvals table', async () => {
            const approvals = await msigworlds.approvalsTable({
              scope: 'dac1',
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
            const props = await msigworlds.proposalsTable({ scope: 'dac1' });
            expect(props.rows[0].modified_date).to.afterTime(modDate);
            expect(props.rows[0].earliest_exec_time).to.be.null;
            expect(props.rows[0].state).to.equal(2);
          });
        });
        context('after proposal has already been cancelled', async () => {
          it('should fail with state error', async () => {
            await assertEOSErrorIncludesMessage(
              msigworlds.cancel('prop1', owner1.name, 'dac1', {
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
        'dac1',
        [],
        {
          actions: await api.serializeActions([
            {
              account: 'alienworlds',
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
        scope: 'dac1',
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
            'dac1',

            { from: owner3 }
          )
        );
      });
    });
    context('with correct auth', async () => {
      context('with non-existing proposal', async () => {
        it('should fail with prop not found error', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.exec('prop11', owner1.name, 'dac1', {
              from: owner1,
            }),
            'proposal not found'
          );
        });
      });

      context('for proposal from that is already cancelled', async () => {
        it('should fail with proposal not in pending state.', async () => {
          await assertEOSErrorIncludesMessage(
            msigworlds.exec('prop1', owner3.name, 'dac1', {
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
          msigworlds.exec('prop2', owner1.name, 'dac1', {
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
          'dac1',
          [],
          {
            actions: await api.serializeActions([
              {
                account: 'alienworlds',
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
          scope: 'dac1',
          lowerBound: 'propexp',
          upperBound: 'propexp',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propexp');
        expect(prop.id).to.equal(3);
      });
      it('should fail with expired error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.exec('propexp', owner1.name, 'dac1', {
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
          'dac1',
          [],
          {
            actions: await api.serializeActions([
              {
                account: 'alienworlds',
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
          'dac1',
          null,
          { from: owner1 }
        );

        await msigworlds.approve(
          'propgood',
          { actor: owner2.name, permission: 'active' },
          'dac1',
          null,
          { from: owner2 }
        );
      });
      it('should succeed', async () => {
        await msigworlds.exec('propgood', owner1.name, 'dac1', {
          from: owner1,
        });
      });
      it('propgood should have the correct id', async () => {
        const res = await msigworlds.proposalsTable({
          scope: 'dac1',
          lowerBound: 'propgood',
          upperBound: 'propgood',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propgood');
        expect(prop.id).to.equal(4);
      });

      it('should update approvals table', async () => {
        const approvals = await msigworlds.approvalsTable({
          scope: 'dac1',
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
        const props = await msigworlds.proposalsTable({ scope: 'dac1' });
        expect(props.rows[0].modified_date).to.afterTime(modDate);
        expect(props.rows[0].earliest_exec_time).to.be.null;
        expect(props.rows[0].state).to.equal(2);
      });
    });
    context('after proposal has already been executed', async () => {
      it('should fail with state error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.exec('propgood', owner1.name, 'dac1', {
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
          msigworlds.cleanup('fakeprop', 'dac1'),
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
          'dac1',
          [],
          {
            actions: await api.serializeActions([
              {
                account: 'alienworlds',
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
          'dac1',
          null,
          { from: owner1 }
        );

        await msigworlds.approve(
          'propclean',
          { actor: owner2.name, permission: 'active' },
          'dac1',
          null,
          { from: owner2 }
        );
      });
      it('propclean should have the correct id', async () => {
        const res = await msigworlds.proposalsTable({
          scope: 'dac1',
          lowerBound: 'propclean',
          upperBound: 'propclean',
        });
        const prop = res.rows[0];
        expect(prop.proposal_name).to.equal('propclean');
        expect(prop.id).to.equal(5);
      });
      it('shoul fail with wrong state error', async () => {
        await assertEOSErrorIncludesMessage(
          msigworlds.cleanup('propclean', 'dac1'),
          'ERR::PROPOSAL_CLEANUP_STILL_PENDING'
        );
      });
    });
    context('with completed proposal', async () => {
      it('should succeed', async () => {
        await msigworlds.cleanup('propgood', 'dac1');
      });
      it('should erase the proposals and approvals record', async () => {
        await assertRowCount(
          msigworlds.proposalsTable({ scope: 'dac1', lowerBound: 'propgood' }),
          0
        );
        await assertRowCount(
          msigworlds.approvalsTable({ scope: 'dac1', lowerBound: 'propgood' }),
          0
        );
      });
    });
  });
});

async function configureAuths() {
  await UpdateAuth.execUpdateAuth(
    [{ actor: msigowned.name, permission: 'active' }],
    msigowned.name,
    'xfer',
    'active',
    UpdateAuth.AuthorityToSet.explicitAuthorities(
      2,
      [
        { permission: { actor: owner1.name, permission: 'active' }, weight: 1 },
        { permission: { actor: owner2.name, permission: 'active' }, weight: 1 },
      ],
      [],
      []
    )
  );

  await UpdateAuth.execUpdateAuth(
    [{ actor: msigowned.name, permission: 'owner' }],
    msigowned.name,
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
        {
          permission: { actor: msigowned.name, permission: 'xfer' },
          weight: 1,
        },
      ],
      [],
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
