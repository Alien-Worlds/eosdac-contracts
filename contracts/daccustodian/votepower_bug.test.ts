import { Account, sleep } from 'lamington';
import { SharedTestObjects } from '../TestHelpers';
import * as chai from 'chai';

/*
  This test intentionally reproduces the "ERR:INVALID_VOTE_POWER" assertion
  that we are seeing on main-net.  The sequence is:
  1.  voter casts a vote for `candidate` (candidate receives the expected weight).
  2.  the candidate disables himself (withdrawcane) and removes the candidate
      row (removecand).
     -> while the row is gone any updates to vote weight are silently dropped;
        the candidate now has *zero* recorded vote power but the voter still
        references him in his ballot.
  3.  the candidate re-nominates (row recreated with          total_vote_power = 0).
  4.  the voter tries to remove his vote – the contract will attempt to
        subtract the full weight from 0 and throws
        ERR:INVALID_VOTE_POWER.
*/

describe('Daccustodian VotePowerBugFix', () => {
  const dacId = 'bugdac';
  let shared: SharedTestObjects;
  let voter: Account;
  let candidate: Account;

  before(async () => {
    shared = await SharedTestObjects.getInstance();

    // Fresh DAC with its own symbol so that we don't interfere with other tests
    await shared.initDac(dacId, '4,BUG', '1000000.0000 BUG');

    // 0 lock-up so that candidates don't need to stake to nominate.
    await shared.updateconfig(dacId, '0.0000 BUG');

    // Create two registered members (voter & candidate) and give them balance
    [voter, candidate] = await shared.getRegMembers(dacId, '1000.0000 BUG', 2);

    // Candidate nominates (requested pay set to 0 EOS to satisfy the config)
    await shared.daccustodian_contract.nominatecane(
      candidate.name,
      '0.0000 EOS',
      dacId,
      { from: candidate }
    );

    // voter votes for our candidate
    await shared.daccustodian_contract.votecust(
      voter.name,
      [candidate.name],
      dacId,
      { from: voter }
    );

    // Give the chain a moment – not strictly necessary but keeps the
    //   test output deterministic
    await sleep(200);
  });

  it('removing the vote no longer triggers unsigned-subtraction', async () => {
    // 1. Candidate disables and removes himself (row is erased)
    await shared.daccustodian_contract.withdrawcane(candidate.name, dacId, {
      from: candidate,
    });
    await shared.daccustodian_contract.removecand(candidate.name, dacId, {
      from: candidate,
    });

    // 2. Candidate re-nominates (row recreated with zero vote power)
    await shared.daccustodian_contract.nominatecane(
      candidate.name,
      '0.0001 EOS',
      dacId,
      { from: candidate }
    );

    // 3. voter tries to remove his vote – this must now succeed (no throw)
    await shared.daccustodian_contract.votecust(voter.name, [], dacId, {
      from: voter,
    });

    // Verify candidate row is still present and vote counters are 0.
    const candRow = (
      await shared.daccustodian_contract.candidatesTable({
        scope: dacId,
        lower_bound: candidate.name,
        upper_bound: candidate.name,
        limit: 1,
      })
    ).rows[0];

    chai.expect(Number(candRow.total_vote_power)).to.equal(0);
    chai.expect(Number(candRow.number_voters)).to.equal(0);
  });
});
