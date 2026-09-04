<h1 class="contract">
init
</h1>

## ACTION: init
**PARAMETERS:**
* __sender__ is an eosio account name. 
* __receiver__ is an eosio account name. 
* __arb__ is an eosio account name. 
* __expires__ The date/time after which the escrow amount can be refunded by the sender. 
* __memo__ is a memo to send as the eventual transfer memo at the end of the escrow contract. 
* __ext_reference__ is a reference to to external id held my another contract or entity as opposed to the internal auto-incrementing key.

**INTENT** The intent of init is to create an empty escrow payment agreement for safe and secure funds transfer protecting both sender and receiver for a determined amount of time. 
#### Warning: This action will store the content on the chain in the history logs and the data cannot be deleted later so therefore should only store a unidentifiable hash of content rather than human readable content. 

<h1 class="contract">
    transfer
</h1>

## ACTION: transfer
**PARAMETERS:**
* __from__ is an eosio account name. 
* __to__ is an eosio account name. 
* __quantity__ is an eosio asset name. 
* __memo__ is a string that provides a memo for the transfer action.

**INTENT:** 
The intent of transfer is to listen and react to the eosio.token contract's transfer action and ensure the correct parameters have been included in the transfer action.
##Warning: This action will store the content on the chain in the history logs and the data cannot be deleted later.

<h1 class="contract">
approve
</h1>

## ACTION: approve
**PARAMETERS:**
* __key__ is a unique identifying integer for an escrow entry. 
* __approver__ is an eosio account name. 

**INTENT:** 
The intent of approve is to approve the release of funds to the intended receiver. The approver must be either the sender, when the escrow is not disputed, or the appointed arbitrator, when it is; the receiver is assumed to always approve of the release of funds. This action is only callable by the worker proposals contract, so that the escrow and the proposal it belongs to are always settled in the same transaction and cannot disagree about whether the work is still live.
 ####Warning: This action will store the content on the chain in the history logs and the data cannot be deleted later.

<h1 class="contract">
 disapprove
</h1>

## ACTION: disapprove
**PARAMETERS:**
* __key__ is a unique identifying integer for an escrow entry. 
* __disapprover__ is an eosio account name. 

**INTENT:** 
The intent of disapprove is to disapprove the release of funds to the intended receiver. The disapprover must be the appointed arbitrator and the escrow must be disputed. The result is that the funds contained in the escrow are returned to the sender, less any arbitration fee. This action is only callable by the worker proposals contract, which reaches it through the arbiter's ruling.
 ####Warning: This action will store the content on the chain in the history logs and the data cannot be deleted later. 

<h1 class="contract">
  refund
</h1>

## ACTION: refund

**PARAMETERS:**
* __key__ is a unique identifying integer for an escrow entry. 

**INTENT:** The intent of refund is to return the escrowed funds back to the original sender, including any amount escrowed for the arbiter, since an arbiter fee is only earned by ruling on a dispute and a refund means no ruling took place. It is only callable by the worker proposals contract, which reaches it when the proposer cancels work they have started, or when the DAC reclaims an escrow that the worker has abandoned after it has passed its expiry time. Those actions carry the rules about who may recover the funds and when.
**TERM:** This action lasts for the duration of the time taken to process the transaction.


<h1 class="contract">
  cancel
</h1>

## ACTION: cancel

**PARAMETERS:**
* __key__ is a unique identifying integer for an escrow entry. 

**INTENT:** The intent of cancel is to cancel an escrow agreement and return any amount escrowed for the arbiter to the sender. This action can only be performed by the sender as long as no funds have already been transferred for the escrow agreement. Once the escrow has been funded it has to be settled through the worker proposals contract instead.
**TERM:** This action lasts for the duration of the time taken to process the transaction.

<h1 class="contract">
  dispute
</h1>

## ACTION: dispute

**PARAMETERS:**
* __key__ is a unique identifying integer for an escrow entry.
* __dac_id__ is an account name representing the DAC for this action.

**INTENT:** The intent of dispute is to lock a funded escrow so that it can no longer be released or refunded by the sender or the receiver, and can only be resolved by the appointed arbitrator. It is only callable by the worker proposals contract, which sends it while moving the proposal into its disputed state, so that the lock on the escrow and the state of the proposal always agree.
**TERM:** This action lasts for the duration of the time taken to process the transaction.
