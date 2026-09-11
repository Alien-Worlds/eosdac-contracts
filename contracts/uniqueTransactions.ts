import { EOSManager } from 'lamington';

/**
 * Stops tests failing with `duplicate transaction`.
 *
 * An EOSIO transaction id is a hash of the packed transaction, which covers the
 * actions, the TAPoS reference block, and the expiration. Lamington sends every
 * transaction with `blocksBehind: 1` and `expireSeconds: 30`, so for two calls
 * made close together:
 *
 *   - the reference block is the same, because blocks are 500ms apart and both
 *     calls resolve to the same head - 1
 *   - the expiration is the same, because it is a whole number of seconds
 *
 * If the actions also match -- same contract, action, authorization and data --
 * the two transactions are byte-identical, hash identically, and nodeos rejects
 * the second as a duplicate. It never reaches the contract, so the failure says
 * nothing about the code under test.
 *
 * This is why it hits CI far harder than a laptop: a dedicated runner pushes
 * more calls into each block and each second, so the window that has to be
 * shared is easier to hit. It reddened three of our first CI runs and none of
 * the local ones.
 *
 * The usual advice -- vary a memo, or sleep between calls -- puts the burden on
 * whoever writes the next test, and is silently forgotten. `sleep(1000)` had
 * already been added to one of the stakevote blocks for exactly this reason and
 * was not enough. This fixes it once, for every suite.
 *
 * Two layers:
 *
 *   1. Vary the expiration per transaction, so identical actions in the same
 *      block still produce different bytes. No waiting, and it prevents the
 *      collision rather than recovering from it.
 *   2. Retry once on a duplicate anyway, as a backstop. Safe because a rejected
 *      duplicate was never applied: there is no partial state to undo, and the
 *      retry picks up a later reference block.
 *
 * Applied by importing this module, which `TestHelpers` does on behalf of every
 * suite. Importing it more than once is harmless.
 */

/** Longest a test transaction may sit unconfirmed. Well under the chain's 3600s ceiling. */
const BASE_EXPIRE_SECONDS = 30;

/** How far the expiration is allowed to drift, to keep transactions distinct. */
const EXPIRY_SPREAD_SECONDS = 120;

/** One block is 500ms; wait past it so a retry lands on a later reference block. */
const ONE_BLOCK_MS = 600;

const isDuplicate = (error: unknown): boolean =>
  /duplicate transaction/i.test(
    error instanceof Error ? error.message : String(error)
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Transact = typeof EOSManager.transact;

// Guard against double-patching if this module is somehow evaluated twice.
const marker = '__uniqueTransactionsApplied';
const manager = EOSManager as unknown as Record<string, unknown>;

if (!manager[marker]) {
  manager[marker] = true;

  const original = EOSManager.transact.bind(EOSManager) as Transact;
  let sent = 0;

  const nextExpiry = () =>
    BASE_EXPIRE_SECONDS + (sent++ % EXPIRY_SPREAD_SECONDS);

  EOSManager.transact = (async (transaction: any, options?: any) => {
    // Only supply an expiration when the caller has not chosen one, so a test
    // that deliberately sets a short or long expiry keeps its behaviour.
    const withExpiry = (expireSeconds: number) =>
      options?.expireSeconds === undefined
        ? { ...(options ?? {}), expireSeconds }
        : options;

    try {
      return await original(transaction, withExpiry(nextExpiry()));
    } catch (error) {
      if (!isDuplicate(error)) throw error;

      // The duplicate was rejected, not applied, so resending is safe. Waiting
      // past a block boundary changes the reference block as well as the
      // expiration, which makes the retry distinct on two counts.
      await sleep(ONE_BLOCK_MS);
      return original(transaction, withExpiry(nextExpiry()));
    }
  }) as Transact;
}

export {};
