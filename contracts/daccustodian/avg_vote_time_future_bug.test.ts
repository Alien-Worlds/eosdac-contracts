import { Account, sleep, assertEOSErrorIncludesMessage } from 'lamington';
import { SharedTestObjects } from '../TestHelpers';
import * as chai from 'chai';

/*
  Reproduces the "avg_vote_time_stamp pushed into the future" bug.
  Steps (see timestamp_future_bug_reproduction.md):
  1.  voter1 votes for candidate -> candidate gets positive vote power.
  2.  Inject a small negative weight delta making new_vote_power slightly negative
      (weightobsv with -10003 when voter had 10000 weight) ->
      total_vote_power is clamped to 0 but running_weight_time stays positive.
  3.  voter2 now votes for the same candidate -> avg_vote_time_stamp becomes
      > now() and contract asserts with the error string.
*/

describe('AvgVoteTimeStampFutureBug', () => {
  const dacId = 'bug2dac';
  let shared: SharedTestObjects;
  let voter1: Account;
  let voter2: Account;
  let candidate: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    console.log('DEBUG: SharedTestObjects instance obtained');

    // Fresh DAC so we do not interfere with other tests
    await shared.initDac(dacId, '4,BUX', '1000000.0000 BUX');
    console.log('DEBUG: initDac completed');

    // Require a 12 token lock-up for candidates (as per reproduction doc)
    await shared.updateconfig(dacId, '12.0000 BUX');
    console.log('DEBUG: updateconfig completed');

    // Enable staking with standard min/max stake times (must be >= lockup_release_time_delay)
    await shared.dac_token_contract.stakeconfig(
      { enabled: true, min_stake_time: 1233, max_stake_time: 1500 },
      '4,BUX',
      { from: shared.auth_account }
    );
    console.log('DEBUG: stakeconfig completed');

    // Create voters with small balances
    [voter1, voter2] = await shared.getRegMembers(dacId, '1.0000 BUX', 2);
    console.log('DEBUG: Registered voter1 and voter2');

    // Create candidate and give a higher balance so that he can stake 12 tokens
    [candidate] = await shared.getRegMembers(dacId, '100.0000 BUX', 1);
    console.log('DEBUG: Candidate registered');

    // Candidate stakes the required lock-up amount
    await shared.dac_token_contract.stake(candidate.name, '12.0000 BUX', {
      from: candidate,
    });
    console.log('DEBUG: Candidate staked 12 BUX');

    // Candidate nominates (requested pay = 0)
    await shared.daccustodian_contract.nominatecane(
      candidate.name,
      '0.0000 EOS',
      dacId,
      { from: candidate }
    );
    console.log('DEBUG: Candidate nominated');

    // Initial positive vote from voter1
    await shared.daccustodian_contract.votecust(
      voter1.name,
      [candidate.name],
      dacId,
      { from: voter1 }
    );
    console.log('DEBUG: Voter1 voted for candidate');

    // Give the chain a moment to process
    await sleep(200);
    console.log('DEBUG: Sleep after first vote');

    // Inject small negative weight adjustment: -10003 makes new_vote_power ≈ -3
    // This triggered the bug by resetting the total_vote_power to 0 but not resetting the running_weight_time as well.
    await shared.daccustodian_contract.weightobsv(
      [
        {
          account: voter1.name,
          weight_delta: -10003,
          weight_delta_quorum: -10003,
        },
      ],
      dacId,
      { from: shared.dac_token_contract.account }
    );
    console.log('DEBUG: weightobsv with negative delta completed');

    await sleep(200);
    console.log('DEBUG: Sleep after weightobsv');
  });

  it('votecust should no longer fail with "avg_vote_time_stamp pushed into the future"', async () => {
    // The action should now succeed without throwing. Afterwards, verify candidate stats.
    await shared.daccustodian_contract.votecust(
      voter2.name,
      [candidate.name],
      dacId,
      { from: voter2 }
    );

    const candRow = (
      await shared.daccustodian_contract.candidatesTable({
        scope: dacId,
        lower_bound: candidate.name,
        upper_bound: candidate.name,
        limit: 1,
      })
    ).rows[0];

    // avg_vote_time_stamp should not be in the future
    chai
      .expect(candRow.avg_vote_time_stamp.getTime())
      .to.be.at.most(Date.now());

    // total_vote_power should now be positive (voter2's weight)
    chai.expect(Number(candRow.total_vote_power)).to.be.greaterThan(0);
  });
});
