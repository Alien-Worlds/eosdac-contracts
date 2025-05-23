import { Account, AccountManager, debugPromise, sleep, assertEOSErrorIncludesMessage, ContractLoader, EOSManager, assertMissingAuthority } from 'lamington';
import { SharedTestObjects } from '../TestHelpers';
import * as chai from 'chai';
import { EosioToken } from '../external_contracts/eosio.token/eosio.token';
let eosiotoken: EosioToken;

const { assert } = chai;

const api = EOSManager.api;

const currentHeadTimeWithAddedSeconds = async (seconds: number) => {
  const { head_block_time } = await EOSManager.api.rpc.get_info();
  const date = new Date(new Date(head_block_time).getTime() + seconds * 1000);
  return date;
};

describe('DACEscrow', () => {
  let shared: SharedTestObjects;
  let sender: Account;
  let receiver: Account;
  let arbiter: Account;
  let dacId: string;
  let regMembers: Account[];

  const escrowKey = 'testescrow1';
  const memo = 'Test escrow payment';
  const receiverPayAmount = '10.0000 EOS';
  const arbiterPayAmount = '1.0000 EOS';

  before(async () => {
    shared = await SharedTestObjects.getInstance();
    dacId = 'escrowdac';
    eosiotoken = await ContractLoader.at('eosio.token');
    // Create test accounts
    sender = await AccountManager.createAccount('escsender');
    receiver = await AccountManager.createAccount('escreceiver');
    arbiter = await AccountManager.createAccount('escarbiter');

    const eos_issuer = new Account('eosio');
    await eosiotoken.issue(
      eos_issuer.name,
      '10000000.0000 EOS',
      'initial deposit',
      {
        from: eos_issuer,
      }
    );
    console.log("Ohai 4");
    await eosiotoken.transfer(
      eos_issuer.name,
      sender.name,
      `1500.0000 EOS`,
      '',
      { from: eos_issuer }
    );
    await shared.initDac(dacId, '4,ESCDAC', '1000000.0000 ESCDAC');
    await shared.updateconfig(dacId, '12.0000 ESCDAC');

    // Enable staking
    await shared.dac_token_contract.stakeconfig(
      { enabled: true, min_stake_time: 1233, max_stake_time: 20 },
      '4,ESCDAC',
      { from: shared.auth_account }
    );

    regMembers = await shared.getRegMembers(dacId, '20000.0000 ESCDAC');
    const custodians = await shared.getStakeObservedCandidates(
      dacId,
      '20.0000 ESCDAC'
    );
    await shared.voteForCustodians(regMembers, custodians, dacId);
    await shared.daccustodian_contract.newperiod('escDac', dacId, {
      from: regMembers[0],
    });
  });

  describe('Basic Escrow Operations', () => {
    it('should initialize a new escrow', async () => {
      const expires = new Date(Date.now() + 86400000); // 24 hours from now
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        escrowKey,
        dacId,
        { from: sender }
      );

      // Verify escrow was created
      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });

      assert.equal(escrows.rows.length, 1);
      assert.equal(escrows.rows[0].key, escrowKey);
      assert.equal(escrows.rows[0].sender, sender.name);
      assert.equal(escrows.rows[0].receiver, receiver.name);
      assert.equal(escrows.rows[0].arb, arbiter.name);
      assert.equal(escrows.rows[0].memo, memo);
      assert.equal(escrows.rows[0].disputed, false);
    });

    it('should accept receiver payment transfer', async () => {
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${escrowKey}:${dacId}`,
        { from: sender }
      );

      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });

      assert.equal(escrows.rows[0].receiver_pay.quantity, receiverPayAmount);
    });

    it('should accept arbiter payment transfer', async () => {
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        arbiterPayAmount,
        `arb:${escrowKey}:${dacId}`,
        { from: sender }
      );

      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });

      assert.equal(escrows.rows[0].arbiter_pay.quantity, arbiterPayAmount);
    });

    it('should allow arbiter to approve escrow', async () => {
      // First dispute the escrow
      await shared.dacescrow_contract.dispute(
        escrowKey,
        dacId,
        { from: receiver }
      );

      await shared.dacescrow_contract.approve(
        escrowKey,
        arbiter.name,
        dacId,
        { from: arbiter }
      );

      // Verify escrow was removed after approval
      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });
      assert.equal(escrows.rows.length, 0);
    });
  });

  describe('Dispute Resolution', () => {
    let disputeEscrowKey: string;

    before(async () => {
      disputeEscrowKey = 'dispute1';
      const expires = new Date(Date.now() + 86400000);

      // Create new escrow for dispute tests
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        disputeEscrowKey,
        dacId,
        { from: sender }
      );

      // Fund the escrow
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${disputeEscrowKey}:${dacId}`,
        { from: sender }
      );

      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        arbiterPayAmount,
        `arb:${disputeEscrowKey}:${dacId}`,
        { from: sender }
      );
    });

    it('should allow receiver to dispute escrow', async () => {
      await shared.dacescrow_contract.dispute(
        disputeEscrowKey,
        dacId,
        { from: receiver }
      );

      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });
      assert.equal(escrows.rows[0].disputed, true);
    });

    it('should allow arbiter to disapprove disputed escrow', async () => {
      await shared.dacescrow_contract.disapprove(
        disputeEscrowKey,
        arbiter.name,
        dacId,
        { from: arbiter }
      );

      // Verify escrow was removed after disapproval
      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });
      assert.equal(escrows.rows.length, 0);
    });
  });

  describe('Refund and Cancel Operations', () => {
    let refundEscrowKey: string;

    before(async () => {
      refundEscrowKey = 'refund1';
      // Set expiry to 2 seconds in the future
      const expires = await currentHeadTimeWithAddedSeconds(2);

      // Create new escrow for refund tests
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        refundEscrowKey,
        dacId,
        { from: sender }
      );

      // Fund the escrow
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${refundEscrowKey}:${dacId}`,
        { from: sender }
      );
    });

    it('should allow sender to cancel unfunded escrow', async () => {
      const cancelKey = 'cancel1';
      const expires = await currentHeadTimeWithAddedSeconds(3600); // 1 hour in the future

      // Create new unfunded escrow
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        cancelKey,
        dacId,
        { from: sender }
      );

      await shared.dacescrow_contract.cancel(
        cancelKey,
        dacId,
        { from: sender }
      );

      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });
      assert.equal(escrows.rows.find(e => e.key === cancelKey), undefined);
    });

    it('should allow refund after expiry', async () => {
      // Wait for 2 seconds to ensure escrow has expired
      await sleep(2000);

      await shared.dacescrow_contract.refund(
        refundEscrowKey,
        dacId,
        { from: sender }
      );

      const escrows = await shared.dacescrow_contract.escrowsTable({
        scope: dacId,
      });
      assert.equal(escrows.rows.find(e => e.key === refundEscrowKey), undefined);
    });
  });

  describe('Error Cases', () => {
    it('should not allow non-sender to cancel escrow', async () => {
      const cancelKey = 'cancel2';
      const expires = await currentHeadTimeWithAddedSeconds(3600);

      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        cancelKey,
        dacId,
        { from: sender }
      );

      await assertMissingAuthority(
        shared.dacescrow_contract.cancel(
          cancelKey,
          dacId,
          { from: receiver }
        )
      );
    });

    it('should not allow non-arbiter to approve escrow', async () => {
      const approveKey = 'approve2';
      const expires = await currentHeadTimeWithAddedSeconds(3600);

      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        approveKey,
        dacId,
        { from: sender }
      );

      // Fund the escrow
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${approveKey}:${dacId}`,
        { from: sender }
      );

      await assertEOSErrorIncludesMessage(
        shared.dacescrow_contract.approve(
          approveKey,
          receiver.name,
          dacId,
          { from: receiver }
        ),
        'ERR::ESCROW_NOT_ALLOWED_TO_APPROVE::Only the arbiter or sender can approve an escrow'
      );
    });

    it('should not allow initialization with expired date', async () => {
      const expiredKey = 'expired1';
      const expires = new Date(Date.now() - 86400000); // 24 hours in the past

      await assertEOSErrorIncludesMessage(
        shared.dacescrow_contract.init(
          sender.name,
          receiver.name,
          arbiter.name,
          expires,
          memo,
          expiredKey,
          dacId,
          { from: sender }
        ),
        'Expiry date is in the past'
      );
    });
  });

  describe('Transfer Edge Cases', () => {
    it('should reject transfer with invalid memo format', async () => {
      const invalidKey = 'invalid1';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        invalidKey,
        dacId,
        { from: sender }
      );

      await assertEOSErrorIncludesMessage(
        eosiotoken.transfer(
          sender.name,
          shared.dacescrow_contract.account.name,
          '1.0000 EOS',
          'invalid_memo', // Missing required format rec:key:dacid
          { from: sender }
        ),
        'Invalid memo format'
      );
    });

    it('should reject transfer to already funded escrow', async () => {
      const doublePayKey = 'doublepay';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name, 
        arbiter.name,
        expires,
        memo,
        doublePayKey,
        dacId,
        { from: sender }
      );

      // First payment
      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${doublePayKey}:${dacId}`,
        { from: sender }
      );

      // Second payment should fail (using different amount)
      await assertEOSErrorIncludesMessage(
        eosiotoken.transfer(
          sender.name,
          shared.dacescrow_contract.account.name,
          '5.0000 EOS', // Different amount to avoid duplicate transaction
          `rec:${doublePayKey}:${dacId}`,
          { from: sender }
        ),
        'ERR::TRANSFER_RECEIVER::This escrow has already paid been into for the recevier'
      );
    });
  });

  describe('Dispute Edge Cases', () => {
    it('should not allow sender to dispute escrow', async () => {
      const senderDisputeKey = 'senderdispute';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        senderDisputeKey,
        dacId,
        { from: sender }
      );

      await assertMissingAuthority(
        shared.dacescrow_contract.dispute(
          senderDisputeKey,
          dacId,
          { from: sender }
        )
      );
    });

    it('should not allow dispute of unfunded escrow', async () => {
      const unfundedKey = 'unfunded';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        unfundedKey,
        dacId,
        { from: sender }
      );

      await assertEOSErrorIncludesMessage(
        shared.dacescrow_contract.dispute(
          unfundedKey,
          dacId,
          { from: receiver }
        ),
        'This has not been initialized with a transfer'
      );
    });
  });

  describe('Refund Edge Cases', () => {
    it('should not allow arbiter to refund', async () => {
      const arbRefundKey = 'arbrefund';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        arbRefundKey,
        dacId,
        { from: sender }
      );

      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${arbRefundKey}:${dacId}`,
        { from: sender }
      );

      await assertMissingAuthority(
        shared.dacescrow_contract.refund(
          arbRefundKey,
          dacId,
          { from: arbiter }
        )
      );
    });

    it('should not allow refund of disputed escrow', async () => {
      const disputedRefundKey = 'disprefund';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        disputedRefundKey,
        dacId,
        { from: sender }
      );

      await eosiotoken.transfer(
        sender.name,
        shared.dacescrow_contract.account.name,
        receiverPayAmount,
        `rec:${disputedRefundKey}:${dacId}`,
        { from: sender }
      );

      await shared.dacescrow_contract.dispute(
        disputedRefundKey,
        dacId,
        { from: receiver }
      );

      await assertEOSErrorIncludesMessage(
        shared.dacescrow_contract.refund(
          disputedRefundKey,
          dacId,
          { from: receiver }
        ),
        'ERR::ESCROW_DISPUTED::This escrow is locked and can only be approved/disapproved by the arbiter'
      );
    });
  });

  describe('Initialization Edge Cases', () => {
    it('should not allow duplicate escrow keys', async () => {
      const duplicateKey = 'duplicate';
      const expires = await currentHeadTimeWithAddedSeconds(3600);
      
      await shared.dacescrow_contract.init(
        sender.name,
        receiver.name,
        arbiter.name,
        expires,
        memo,
        duplicateKey,
        dacId,
        { from: sender }
      );

      // Second attempt with different memo to avoid duplicate transaction
      await assertEOSErrorIncludesMessage(
        shared.dacescrow_contract.init(
          sender.name,
          receiver.name,
          arbiter.name,
          expires,
          memo + ' second attempt',
          duplicateKey,
          dacId,
          { from: sender }
        ),
        'Already have an escrow with this external reference'
      );
    });
  });
}); 