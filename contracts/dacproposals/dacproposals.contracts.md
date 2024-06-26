<h1 class="contract">
createprop
</h1>

## ACTION: createprop

**PARAMETERS:**

- **proposer** is an eosio account name.
- **title** is a string that provides a title for the proposal.
- **summary** is a string that provides a summary for the proposal.
- **arbitrator** is an eosio account name for a nominated arbitrator on the proposal.
- **pay_amount** is an eosio asset amount representing the requested pay amount for the worker proposal.
- **id** is an uint64 to represent the a unique identifer for a new proposal.
- **dac_id** is an eosio name the proposal to a specific dac.
- **category** is integer to categorise a proposal.
- **content_hash** is a string that provides a hash of the details of the proposal.

**INTENT** The intent of createprop is to enter a new worker proposal.

#### Warning: This action will store the content on the chain in the history logs and the data cannot be deleted later so therefore should only store a unidentifiable hash of content rather than human readable content.

<h1 class="contract">
    voteprop
</h1>

## ACTION: voteprop

**PARAMETERS:**

- **custodian** is an eosio account name.
- **proposal_id** is an integer id for an existing proposal for the custodian to vote on.
- **vote** is an integer repesenting a vote type on the proposal.

**INTENT:**
The intent of voteprop is to record a vote on an existing proposal.

<h1 class="contract">
    delegatevote
</h1>

## ACTION: delegatevote

**PARAMETERS:**

- **custodian** is an eosio account name.
- **proposal_id** is an integer id for an existing proposal for the custodian to vote on.
- **dalegatee_custodian** is an eosio account name for a custodian to delegate worker proposal votes to.

**INTENT:**
The intent of delegatevote is to delegate an active custodian's vote to another custodian because they trust their opinion over their own.

<h1 class="contract">
    delegatecat
</h1>

## ACTION: delegatecat

**PARAMETERS:**

- **custodian** is an eosio account name.
- **category** is an integer id for an existing category for the custodian to delgate voting power for.
- **dalegatee_custodian** is an eosio account name for a custodian to delegate worker proposal votes to.
- **dac_id** is an account name representing the DAC for this action

**INTENT:**
The intent of delegatecat is to delegate an active custodian's vote to another custodian because they trust their opinion over their own for all proposals in a particular category. This will be overriden by a delegation for a specific proposal which would be overriden by a proposal specific vote.

<h1 class="contract">
    undelegateca
</h1>

## ACTION: undelegateca

**PARAMETERS:**

- **custodian** is an eosio account name.
- **category** is an integer id for an existing category for the custodian to undelgate voting power for.
- **dac_id** is an account name representing the DAC for this action

**INTENT:**
The intent of undelegateca is to remove delegation an active custodian's vote to another custodian for a particular category.

<h1 class="contract">
    clearexpprop
</h1>

## ACTION: clearexpprop

**PARAMETERS:**

- **proposal_id** is an integer representing the id for particular proposal.
- **dac_id** is an account name representing the DAC for this action

**INTENT:**
The intent of clearexpprop is to remove an expired proposal. This is only allowed if the proposal has expired.s

<h1 class="contract">
    updpropvotes
</h1>

## ACTION: updpropvotes

**PARAMETERS:**

- **proposal_id** is an integer representing the id for particular proposal.
- **dac_id** is an account name representing the DAC for this action

**INTENT:**
The intent of updpropvotes is to update the state on the proposal to indicate if there are enough votes to approve the start of a proposal (status code 3), the finalizing vote of a proposal (status code 4) or if it has expired (status code 5).

<h1 class="contract">
    arbapprove
</h1>

## ACTION: arbapprove

**PARAMETERS:**

- **arbitrator** is an eosio account name of the nominated arbitrator for the proposal.
- **proposal_id** is an integer id for an existing proposal for the custodian to vote on.

**INTENT:**
The intent of arbapprove is to cleanup a proposal after the arbitrator has directly approved the escrow in the escrow contract. This cannot perform the approval on the escrow contract without weakening the security integrity of the escrow contract model, since this would require this contract to have the permission for approving an escrow transfer from both the sender and arbitrator's perspective. Since only the escrow contract was intended to be secured from modification then this would be a potential attack vector to the escrow contract.

<h1 class="contract">
startwork
</h1>

## ACTION: startwork

**PARAMETERS:**

- **proposal_id** is an integer id for an existing proposal created by this proposer.

**INTENT:**
The intent of startwork is to indicate the intention for the proposer to start work on an existing proposal.
This action checks that there are enough approval votes from active custodians to approve the proposal and if successful transfers the required amount to an escrow account in preparation for the payment of the worker proposal at the completion of the work.

<h1 class="contract">
completework
</h1>

## ACTION: completework

**PARAMETERS:**

- **proposal_id** is an integer id for an existing proposal created by this proposer.

**INTENT:**
The intent of completework is to indicate that proposer has completed the work on an existing proposal and intends to claim the agreed payment for work. The proposal is then put in the pending_claim state and will await the custodians approval.

<h1 class="contract">
finalize
</h1>

## ACTION: finalize

**PARAMETERS:**

- **proposal_id** is an integer id for an existing proposal for the proposer to finalize.

**INTENT:**
The intent of finalize is to trigger the transfer of funds to the worker from the escrow account. Upon successful transfer the proposal will cleaned from the contract table to free up RAM.

 <h1 class="contract">  
 cancel
 </h1>

## ACTION: cancel

**PARAMETERS:**

- **proposal_id** is an integer id for an existing proposal for the proposer to cancel.

**INTENT:**
The intent of cancel is to cancel a proposal.

 <h1 class="contract">
 comment
 </h1>

## ACTION: comment

\*_PARAMETERS:_

- **commenter** The commenter eos account name
- **proposal_id** is an integer id for an existing proposal for the proposer to comment on.
- **comment** The string representing the comment for the proposal
- **comment_category** The string for comment category to help categorise comments.

**INTENT:**
The intent of comment is to capture and authorise comments related to a proposal.

<h1 class="contract">
 updateconfig
</h1>

## ACTION: updateconfig

**PARAMETERS:**

- **new_config** is a config_type object to update the settings for the contract.

**INTENT:** The intent of updateconfig is to update the contract settings within the contract.
The fields in the config object the their default values are:

- name service_account - The service account to manage the escrow funds for worker proposals.
- name authority_account - The authority account to authorize actions in the all the connected contracts.
- name treasury_account - The account that holds the DAC funds used for the source of funds for the escrow contract.
- uint16_t proposal_threshold = 7 - The number of required votes to make a decision on approving a worker proposal submission.
- uint16_t claim_threshold = 5 - The number of required votes to make a decision on approving a claim for a worker proposal.
- uint32_t escrow_expiry = 30 days - The number of days an escrow is set to expire.
- uint32_t approval_expiry = 30 days - The number of days before a worker proposal must be approved.

**TERM:** This action lasts for the duration of the time taken to process the transaction.
