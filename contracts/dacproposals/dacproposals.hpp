#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/ignore.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>

#include "../../contract-shared-headers/contracts-common/safemath.hpp"
#include "../../contract-shared-headers/daccustodian_shared.hpp"
#include "../../contract-shared-headers/dacdirectory_shared.hpp"
#include "../../contract-shared-headers/eosdactokens_shared.hpp"

using namespace eosio;
using namespace std;

namespace eosdac {

    static constexpr eosio::name VOTE_PROP_APPROVE{"propapprove"};
    static constexpr eosio::name VOTE_PROP_DENY{"propdeny"};
    static constexpr eosio::name VOTE_FINAL_APPROVE{"finalapprove"};
    static constexpr eosio::name VOTE_FINAL_DENY{"finaldeny"};

    static constexpr eosio::name VOTE_ABSTAIN{"abstain"};
    static constexpr eosio::name VOTE_APPROVE{"approve"};
    static constexpr eosio::name VOTE_DENY{"deny"};

    static constexpr eosio::name STATE_PENDING_APPROVAL{"pendingappr"};
    static constexpr eosio::name STATE_IN_PROGRESS{"inprogress"};
    static constexpr eosio::name STATE_PENDING_FINALIZE{"pendingfin"};
    static constexpr eosio::name STATE_HAS_ENOUGH_APP_VOTES{"apprvtes"};
    static constexpr eosio::name STATE_HAS_ENOUGH_FIN_VOTES{"apprfinvtes"};
    static constexpr eosio::name STATE_EXPIRED{"expired"};
    static constexpr eosio::name STATE_DISPUTED{"indispute"};
    static constexpr eosio::name STATE_COMPLETED{"completed"};
    static constexpr eosio::name STATE_BLOCKED{"blocked"};

    CONTRACT dacproposals : public contract {
        enum VoteTypePublic : uint64_t {
            vote_abstain = VOTE_ABSTAIN.value,
            vote_approve = VOTE_APPROVE.value,
            vote_deny    = VOTE_DENY.value,
        };

        enum VoteType : uint64_t {
            none = VOTE_ABSTAIN.value,
            // a vote type to indicate a custodian's approval of a worker proposal.
            proposal_approve = VOTE_PROP_APPROVE.value,
            // a vote type to indicate a custodian's denial of a worker proposal.
            proposal_deny = VOTE_PROP_DENY.value,
            // a vote type to indicate a custodian's acceptance of a worker proposal as completed.
            finalize_approve = VOTE_FINAL_APPROVE.value,
            // a vote type to indicate a custodian's rejection of a worker proposal as completed.
            finalize_deny = VOTE_FINAL_DENY.value
        };

        enum ProposalState : uint64_t {
            ProposalStatePending_approval           = STATE_PENDING_APPROVAL.value,
            ProposalStateWork_in_progress           = STATE_IN_PROGRESS.value,
            ProposalStatePending_finalize           = STATE_PENDING_FINALIZE.value,
            ProposalStateHas_enough_approvals_votes = STATE_HAS_ENOUGH_APP_VOTES.value,
            ProposalStateHas_enough_finalize_votes  = STATE_HAS_ENOUGH_FIN_VOTES.value,
            ProposalStateExpired                    = STATE_EXPIRED.value,
            ProposalStateInDispute                  = STATE_DISPUTED.value,
            ProposalStateCompleted                  = STATE_COMPLETED.value,
            ProposalStateBlocked                    = STATE_BLOCKED.value
        };

      public:
        struct [[eosio::table("deposits"), eosio::contract("dacproposals")]] deposit_info {
            name           account;
            extended_asset deposit;

            uint64_t primary_key() const {
                return account.value;
            }
            uint128_t by_sym() const {
                return (uint128_t{deposit.contract.value} << 64) | deposit.get_extended_symbol().get_symbol().raw();
            };
        };
        using deposits_table = eosio::multi_index<"deposits"_n, deposit_info,
            indexed_by<"bysym"_n, const_mem_fun<deposit_info, uint128_t, &deposit_info::by_sym>>>;

        TABLE proposal {
            name           proposal_id;
            name           proposer;
            name           arbiter;
            string         title;
            string         summary;
            string         content_hash;
            extended_asset proposal_pay;
            extended_asset arbiter_pay;
            bool           arbiter_agreed = false;
            name           state;
            time_point_sec expiry;
            time_point_sec created_at;
            uint32_t       job_duration; // job duration in seconds
            uint16_t       category;

            uint64_t primary_key() const {
                return proposal_id.value;
            }
            uint64_t proposer_key() const {
                return proposer.value;
            }
            uint64_t arbiter_key() const {
                return arbiter.value;
            }
            uint64_t category_key() const {
                return uint64_t(category);
            }

            bool has_not_expired() const {
                time_point_sec time_now = time_point_sec(current_time_point().sec_since_epoch());
                return time_now < expiry;
            }
        };

        using proposal_table = eosio::multi_index<"proposals"_n, proposal,
            eosio::indexed_by<"proposer"_n, eosio::const_mem_fun<proposal, uint64_t, &proposal::proposer_key>>,
            eosio::indexed_by<"arbiter"_n, eosio::const_mem_fun<proposal, uint64_t, &proposal::arbiter_key>>,
            eosio::indexed_by<"category"_n, eosio::const_mem_fun<proposal, uint64_t, &proposal::category_key>>>;

        struct config {
            extended_asset proposal_fee;
            uint8_t        proposal_threshold    = 4;
            uint8_t        finalize_threshold    = 1;
            uint32_t       approval_duration     = 30 * 24 * 60 * 60;
            uint32_t       min_proposal_duration = 0;
        };

        // using configs_table = eosio::singleton<"config"_n, config>;

        // clang-format off
        SINGLETON(configs, dacproposals, 
            PROPERTY(extended_asset, proposal_fee);
            PROPERTY(uint8_t, proposal_threshold); 
            PROPERTY(uint8_t, finalize_threshold);
            PROPERTY(uint32_t, approval_duration); 
            PROPERTY(uint32_t, min_proposal_duration); 
        );


         struct [[eosio::table("arbwl"), eosio::contract("dacproposals")]] arbiter_white_list {
            name arbiter;
            uint64_t rating;

            uint64_t primary_key() const { return arbiter.value; }
        };

        using arbiterwhitelist_table = eosio::multi_index<"arbwhitelist"_n, arbiter_white_list>;
        // clang-format on

        struct [[eosio::table("recwl"), eosio::contract("dacproposals")]] receiver_whitelist {
            name     receiver;
            uint64_t rating;

            uint64_t primary_key() const {
                return receiver.value;
            }
        };

        using rec_whitelist_table = eosio::multi_index<"recwl"_n, receiver_whitelist>;

        dacproposals(name receiver, name code, datastream<const char *> ds) : contract(receiver, code, ds) {}

        /**
         * @brief Creates a new worker proposal for the DAC
         *
         * This is the primary action for submitting work proposals to a DAC. Use this when you want
         * to propose a specific piece of work in exchange for payment. The proposal will enter the
         * approval phase where custodians vote on whether to fund it. This is ideal for contractors,
         * contributors, or DAC members who want to be paid for delivering specific deliverables.
         *
         * The process flow: createprop -> custodian voting -> startwork -> completework -> finalize
         *
         * This action creates a new proposal with the specified parameters:
         * 1. Validates proposer is in the receiver whitelist and arbiter is in arbiter whitelist
         * 2. Checks proposal parameters are valid (title, summary, amounts, etc.)
         * 3. Deducts proposal fee from proposer's deposit if required
         * 4. Creates proposal record with 'pendingappr' state
         *
         * @param proposer The account proposing the work
         * @param title The proposal title (must be 4-255 characters)
         * @param summary The proposal summary (must be 4-511 characters)
         * @param arbiter The designated arbiter for dispute resolution
         * @param proposal_pay The payment amount for the proposer upon completion
         * @param arbiter_pay The payment amount for the arbiter
         * @param content_hash Hash of the detailed proposal content
         * @param id Unique identifier for the proposal
         * @param category Proposal category for voting delegation
         * @param job_duration Expected duration in seconds for completing the work
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposer must be in receiver whitelist and be an active DAC member
         * @pre Arbiter must be in arbiter whitelist with rating > 0
         * @pre Proposer must have sufficient deposit balance if fee is required
         * @pre Proposal ID must be unique
         */
        ACTION createprop(name proposer, string title, string summary, name arbiter, extended_asset proposal_pay,
            extended_asset arbiter_pay, string content_hash, name id, uint16_t category, uint32_t job_duration,
            name dac_id);

        /**
         * @brief Custodian votes on a proposal during the approval phase
         *
         * This is how DAC custodians exercise governance over worker proposals. Use this action
         * to approve proposals you believe provide value to the DAC, or deny those that don't
         * meet standards. This is the primary governance mechanism for allocating DAC resources.
         * Once enough custodians vote 'approve', the proposer can begin work.
         *
         * When to use: Review proposals for feasibility, value, and alignment with DAC goals.
         * Vote 'approve' for good proposals, 'deny' for problematic ones, 'abstain' if uncertain.
         *
         * This action allows custodians to vote on proposals that are pending approval.
         * Votes can be 'approve', 'deny', or 'abstain'. The vote is recorded and
         * proposal vote tallies are updated automatically.
         *
         * @param custodian The custodian casting the vote
         * @param proposal_id The proposal being voted on
         * @param vote The vote type: 'approve', 'deny', or 'abstain'
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the custodian account
         * @pre Custodian must be a current active custodian
         * @pre Proposal must be in 'pendingappr' or 'apprvtes' state
         * @pre Proposal must not have expired
         */
        ACTION voteprop(name custodian, name proposal_id, name vote, name dac_id);

        /**
         * @brief Custodian votes on proposal finalization after work completion
         *
         * This is the final governance checkpoint where custodians verify that work has been
         * completed satisfactorily before releasing payment. Use this to ensure deliverables
         * meet the promised quality and scope. This protects the DAC from paying for
         * incomplete or unsatisfactory work.
         *
         * When to use: After a proposer calls completework(), review their deliverables
         * against the original proposal. Vote 'approve' if satisfied, 'deny' if work
         * is incomplete or unsatisfactory.
         *
         * This action allows custodians to vote on whether completed work should be
         * finalized and payment released. Votes can be 'approve', 'deny', or 'abstain'.
         *
         * @param custodian The custodian casting the vote
         * @param proposal_id The proposal being voted on for finalization
         * @param vote The vote type: 'approve', 'deny', or 'abstain'
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the custodian account
         * @pre Custodian must be a current active custodian
         * @pre Proposal must be in 'pendingfin' or 'apprfinvtes' state
         */
        ACTION votepropfin(name custodian, name proposal_id, name vote, name dac_id);

        /**
         * @brief Delegates voting power for a specific proposal to another custodian
         *
         * Use this when you trust another custodian's judgment on a specific proposal but
         * can't review it yourself due to time constraints, lack of expertise, or conflicts
         * of interest. This allows efficient governance by leveraging specialized knowledge
         * while maintaining your participation in the voting process.
         *
         * When to use: Delegate to custodians with relevant expertise, when traveling/unavailable,
         * or when you have conflicts of interest. Choose trustworthy delegates who share your values.
         *
         * This action allows a custodian to delegate their vote on a specific proposal
         * to another custodian. The delegated vote weight is added to the delegatee's
         * vote when tallying proposal votes.
         *
         * @param custodian The custodian delegating their vote
         * @param proposal_id The proposal for which to delegate the vote
         * @param delegatee_custodian The custodian receiving the delegated vote
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the custodian account
         * @pre Custodian must be a current active custodian
         * @pre Custodian cannot delegate to themselves
         * @pre Proposal must not have expired
         */
        ACTION delegatevote(name custodian, name proposal_id, name delegatee_custodian, name dac_id);

        /**
         * @brief Delegates voting power for an entire proposal category to another custodian
         *
         * Use this for ongoing delegation based on expertise areas. If another custodian has
         * specialized knowledge in development, marketing, legal, etc., you can delegate all
         * proposals in that category to them. This creates efficient specialization while
         * ensuring all votes still get cast.
         *
         * When to use: Set up long-term delegations for categories outside your expertise.
         * For example, non-technical custodians might delegate development proposals to
         * technical custodians, while technical custodians delegate marketing proposals.
         *
         * This action allows a custodian to delegate their vote for all proposals
         * in a specific category to another custodian. This delegation applies to
         * future proposals and those where the custodian hasn't voted directly.
         *
         * @param custodian The custodian delegating their vote
         * @param category The proposal category for which to delegate votes
         * @param delegatee_custodian The custodian receiving the delegated votes
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the custodian account
         * @pre Custodian must be a current active custodian
         * @pre Custodian cannot delegate to themselves
         */
        ACTION delegatecat(name custodian, uint64_t category, name delegatee_custodian, name dac_id);

        /**
         * @brief Removes a custodian's category vote delegation
         *
         * This action removes a previously set category vote delegation, allowing
         * the custodian to vote directly on proposals in that category again.
         *
         * @param custodian The custodian removing their delegation
         * @param category The proposal category to stop delegating
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the custodian account
         * @pre A delegation must exist for the specified category
         */
        ACTION undelegateca(name custodian, uint64_t category, name dac_id);

        /**
         * @brief Arbiter agrees to participate in a proposal
         *
         * This action must be called by the designated arbiter to confirm their
         * agreement to participate in the proposal dispute resolution process.
         * The proposal cannot start work until the arbiter has agreed.
         *
         * @param arbiter The designated arbiter for the proposal
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the designated arbiter for the proposal
         * @pre Proposal must be in 'pendingappr' or 'apprvtes' state
         */
        ACTION arbagree(name arbiter, name proposal_id, name dac_id);
        /**
         * @brief Arbiter approves a disputed proposal, releasing escrowed funds to the proposer
         *
         * This action handles the complete dispute resolution workflow:
         * 1. Validates arbiter authorization and proposal state
         * 2. Automatically calls dacescrow::approve to release funds
         * 3. Updates proposal state to completed
         *
         * @param arbiter The designated arbiter for this proposal
         * @param proposal_id The unique proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must be in 'indispute' state
         * @pre Caller must be the designated arbiter
         * @pre Corresponding escrow must exist and be funded
         */
        ACTION arbapprove(name arbiter, name proposal_id, name dac_id);
        /**
         * @brief Arbiter denies a disputed proposal, returning escrowed funds to DAC
         *
         * This action handles the complete dispute denial workflow:
         * 1. Validates arbiter authorization and proposal state
         * 2. Automatically calls dacescrow::disapprove to return funds
         * 3. Updates proposal state to completed
         *
         * @param arbiter The designated arbiter for this proposal
         * @param proposal_id The unique proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must be in 'indispute' state
         * @pre Caller must be the designated arbiter
         * @pre Corresponding escrow must exist and be funded
         */
        ACTION arbdeny(name arbiter, name proposal_id, name dac_id);

        /**
         * @brief Initiates work on an approved proposal by creating and funding escrow
         *
         * This is the action proposers call once their proposal has been approved by custodians.
         * It officially begins the work phase and secures funding in escrow. Use this after your
         * proposal receives enough approval votes and the arbiter has agreed. From this point,
         * you're committed to delivering the work described in your proposal.
         *
         * When to use: Only call this when you're ready to begin work immediately. Once called,
         * funds are locked in escrow and you'll need to deliver or face potential disputes.
         *
         * This action handles the complete work initiation workflow:
         * 1. Validates proposal approval status and arbiter agreement
         * 2. Creates escrow contract entry via dacescrow::init
         * 3. Transfers proposal and arbiter payments to escrow
         * 4. Updates proposal state to 'inprogress'
         *
         * @param proposal_id The unique proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must have sufficient approval votes
         * @pre Arbiter must have agreed to participate
         * @pre Proposer must be active DAC member
         */
        ACTION startwork(name proposal_id, name dac_id);

        /**
         * @brief Marks proposal work as completed by the proposer
         *
         * This action allows the proposer to indicate that the work described in
         * the proposal has been completed and is ready for finalization voting
         * by custodians. The proposal state changes to 'pendingfin'.
         *
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the original proposer
         * @pre Proposal must be in 'inprogress' state
         * @pre Proposer must be an active DAC member
         */
        ACTION completework(name proposal_id, name dac_id);

        /**
         * @brief Finalizes an approved proposal and releases escrowed funds
         *
         * This action handles the complete finalization workflow:
         * 1. Validates proposal state and finalization vote threshold
         * 2. Checks minimum proposal duration has elapsed
         * 3. Calls transferfunds() which invokes the escrow contract's approve action to release funds to proposer
         * 4. Updates proposal state to 'completed'
         *
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must be in 'pendingfin' or 'apprfinvtes' state
         * @pre Proposal must have sufficient finalization votes (>= finalize_threshold)
         * @pre Minimum proposal duration must have elapsed since creation
         */
        ACTION finalize(name proposal_id, name dac_id);

        /**
         * @brief Cancels a proposal before work begins
         *
         * Use this to withdraw a proposal that hasn't started work yet. Common reasons include
         * realizing the scope was wrong, finding the timeline unrealistic, having personal
         * circumstances change, or deciding the proposal no longer makes sense. This is a
         * clean exit with no financial implications.
         *
         * When to use: Before calling startwork(), when you need to cancel for any reason.
         * Better to cancel early than to start work you can't complete. No escrow has been
         * created yet, so this is penalty-free.
         *
         * This action allows the proposer to cancel their proposal before work
         * has started. The proposal must be in the approval phase and not have
         * an associated escrow. All associated votes are cleaned up.
         *
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the original proposer
         * @pre Proposal must be in 'pendingappr' or 'apprvtes' state
         * @pre No escrow must exist for this proposal
         * @pre Proposer must be an active DAC member
         */
        ACTION cancelprop(name proposal_id, name dac_id);
        /**
         * @brief Cancels work in progress by refunding the escrow
         *
         * Use this when you need to cancel work that has already started due to unforeseen
         * circumstances, insurmountable blockers, or inability to complete. This returns
         * funds to the DAC but may impact your reputation. Use responsibly and communicate
         * clearly with the DAC about why cancellation is necessary.
         *
         * When to use: Only when you genuinely cannot complete the work due to external factors,
         * scope creep, or discovered impossibility. Consider offering partial delivery or
         * modified scope instead. Document your reasons to maintain trust.
         *
         * This action handles work cancellation workflow:
         * 1. Validates proposer authorization and proposal state
         * 2. Automatically calls dacescrow::refund to return funds
         * 3. Cleans up proposal and associated votes
         *
         * @param proposal_id The unique proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must be in progress, pending finalization, or have enough finalization votes
         * @pre Corresponding escrow must exist
         * @pre Caller must be the original proposer
         */
        ACTION cancelwip(name proposal_id, name dac_id);

        /**
         * @brief Initiates a dispute for a proposal that is pending finalization
         *
         * This is your recourse as a proposer when you believe you've completed work satisfactorily
         * but custodians are not voting to finalize payment. Use this when you've delivered what
         * was promised but face unreasonable rejection. This escalates the decision to the neutral
         * arbiter who will make the final determination.
         *
         * When to use: Only use after completing work and facing custodian rejection you believe
         * is unjustified. Be prepared to defend your deliverables to the arbiter. Use sparingly
         * as disputes can damage relationships and reputation.
         *
         * This action handles the complete dispute initiation workflow:
         * 1. Validates proposer authorization and proposal state
         * 2. Automatically calls dacescrow::dispute to lock the escrow
         * 3. Updates proposal state to 'indispute' requiring arbiter resolution
         *
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the original proposer
         * @pre Proposal must be in 'pendingfin' or 'apprfinvtes' state
         * @pre Corresponding escrow must exist
         * @pre Proposer must be an active DAC member
         */
        ACTION dispute(name proposal_id, name dac_id);

        /**
         * @brief Adds a comment to a proposal
         *
         * This action allows DAC members to add comments to proposals. Comments
         * can be categorized and are used for discussion and feedback on proposals.
         * The proposer can comment freely, while others need DAC owner authorization.
         *
         * @param commenter The account adding the comment
         * @param proposal_id The proposal being commented on
         * @param comment The comment text
         * @param comment_category The category of the comment
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the commenter account
         * @pre Commenter must be an active DAC member
         * @pre If not the proposer, requires DAC owner authorization
         * @pre Proposal must exist
         */
        ACTION comment(name commenter, name proposal_id, string comment, string comment_category, name dac_id);

        /**
         * @brief Updates the contract configuration parameters
         *
         * This action allows updating the contract's configuration including
         * proposal thresholds, durations, and fees. Currently requires contract
         * self-authorization for security.
         *
         * @param new_config The new configuration parameters
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         */
        ACTION updateconfig(config new_config, name dac_id);
        // ACTION clearconfig(name dac_id);
        /**
         * @brief Clears an expired proposal from the contract
         *
         * This action removes expired proposals from the contract storage to free up
         * RAM. It can be called by anyone once a proposal has expired. If an escrow
         * exists, the proposal must be expired before it can be cleared.
         *
         * @param proposal_id The proposal identifier to clear
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must exist
         * @pre If escrow exists, proposal must have expired
         */
        ACTION clearexpprop(name proposal_id, name dac_id);

        /**
         * @brief Removes a completed proposal from contract storage
         *
         * This action removes completed proposals from the contract storage to free
         * up RAM. It can only be called on proposals that have reached the 'completed'
         * state, meaning all funds have been distributed.
         *
         * @param proposal_id The proposal identifier to remove
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must exist
         * @pre Proposal must be in 'completed' state
         */
        ACTION rmvcompleted(name proposal_id, name dac_id);

        /**
         * @brief Updates the vote tallies for a proposal
         *
         * This action recalculates and updates the vote counts for a proposal,
         * including direct votes and delegated votes. It also updates the proposal
         * state based on current vote tallies and thresholds.
         *
         * @param proposal_id The proposal identifier
         * @param dac_id The DAC scope identifier
         *
         * @pre Proposal must exist
         * @pre Proposal must be in a state that accepts vote updates
         */
        ACTION updpropvotes(name proposal_id, name dac_id);

        /**
         * @brief Sets the proposal fee for the DAC
         *
         * This action updates the fee required to submit new proposals. The fee
         * is paid by proposers to prevent spam and cover operational costs.
         * Currently requires contract self-authorization.
         *
         * @param new_proposal_fee The new fee amount and token
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself or have authorization bypass
         */
        ACTION setpropfee(extended_asset new_proposal_fee, name dac_id);

        /**
         * @brief Refunds a depositor's funds
         *
         * This action returns deposited funds to an account. Deposits are made
         * when submitting proposals to pay fees, and excess funds can be refunded
         * back to the depositor.
         *
         * @param account The account to refund
         *
         * @pre Account must have a deposit balance
         */
        ACTION refund(name account);

        /**
         * @brief Adds an arbiter to the whitelist
         *
         * This action adds a new arbiter to the whitelist with a specified rating.
         * Arbiters must be whitelisted before they can be selected for proposals.
         * The action also removes the arbiter from the DAO worlds whitelist.
         *
         * @param arbiter The arbiter account to add
         * @param rating The rating/reputation score for the arbiter
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Arbiter must not already exist in the whitelist
         */
        ACTION addarbwl(name arbiter, uint64_t rating, name dac_id);

        /**
         * @brief Updates an existing arbiter's rating in the whitelist
         *
         * This action modifies the rating of an arbiter already in the whitelist.
         * The rating affects the arbiter's eligibility and reputation within the system.
         *
         * @param arbiter The arbiter account to update
         * @param rating The new rating/reputation score
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Arbiter must exist in the whitelist
         */
        ACTION updarbwl(name arbiter, uint64_t rating, name dac_id);

        /**
         * @brief Removes an arbiter from the whitelist
         *
         * This action removes an arbiter from the whitelist, preventing them from
         * being selected for future proposals. This is the unsafe version that
         * does not check for active proposals.
         *
         * @param arbiter The arbiter account to remove
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Arbiter must exist in the whitelist
         */
        ACTION rmvarbwl(name arbiter, name dac_id);

        /**
         * @brief Safely removes an arbiter from the whitelist after validation
         *
         * This action removes an arbiter from the whitelist but first verifies
         * that the arbiter is not currently assigned to any active proposals.
         * This prevents issues with ongoing proposals that require arbiter participation.
         *
         * @param arbiter The arbiter account to remove
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Arbiter must not be assigned to any active proposals
         * @pre All arbiter's proposals must be in 'expired' or 'completed' state
         */
        ACTION safermvarbwl(name arbiter, name dac_id);

        /**
         * @brief Adds a candidate to the receiver whitelist
         *
         * This action adds a new candidate to the receiver whitelist with a specified
         * rating. Accounts must be whitelisted before they can propose work to the DAC.
         *
         * @param cand The candidate account to add to the whitelist
         * @param rating The rating/reputation score for the candidate
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Candidate must not already exist in the whitelist
         */
        ACTION addrecwl(name cand, uint64_t rating, name dac_id);

        /**
         * @brief Updates an existing receiver's rating in the whitelist
         *
         * This action modifies the rating of a receiver already in the whitelist.
         * The rating affects the receiver's eligibility and reputation within the system.
         *
         * @param cand The candidate account to update
         * @param rating The new rating/reputation score
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Candidate must exist in the whitelist
         */
        ACTION updrecwl(name cand, uint64_t rating, name dac_id);

        /**
         * @brief Removes a candidate from the receiver whitelist
         *
         * This action removes a candidate from the receiver whitelist, preventing
         * them from submitting future proposals to the DAC.
         *
         * @param cand The candidate account to remove
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Candidate must exist in the whitelist
         */
        ACTION rmvrecwl(name cand, name dac_id);

        /**
         * @brief Internal notification action for proposal removal
         *
         * This action is called internally when a proposal is removed from the
         * contract to provide notification hooks for external systems or logging.
         *
         * @param prop The proposal being removed
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         */
        ACTION notfyrmv(const proposal &prop, name dac_id);

        /**
         * @brief Blocks a proposal from further processing
         *
         * This action sets a proposal's state to 'blocked', preventing any further
         * actions on the proposal. This is an administrative action for handling
         * problematic proposals.
         *
         * @param proposal_id The proposal identifier to block
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself
         * @pre Proposal must exist
         */
        ACTION blockprop(name proposal_id, name dac_id);

        /**
         * @brief Handles incoming token transfers for proposal fees
         *
         * This notification handler processes incoming token transfers and deposits
         * them for proposal fee payments. The deposited tokens can later be used
         * to pay proposal fees or refunded to the depositor.
         *
         * @param from The account sending the tokens
         * @param to The receiving account (should be this contract)
         * @param quantity The amount and token type being transferred
         * @param memo The transfer memo (currently unused)
         *
         * @pre Transfer must be sent to this contract
         * @pre Sender must not be system accounts (eosio, eosio.ram, eosio.stake)
         */
        [[eosio::on_notify("*::transfer")]] void receive(name from, name to, asset quantity, string memo);

        /**
         * @brief Sets the minimum duration for proposals
         *
         * This action updates the minimum time that must elapse between proposal
         * creation and finalization. This prevents rushed proposals and ensures
         * adequate review time.
         *
         * @param new_min_proposal_duration The new minimum duration in seconds
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the contract itself or have authorization bypass
         */
        ACTION minduration(uint32_t new_min_proposal_duration, name dac_id);

      private:
        void    clearprop(const proposal &proposal, name dac_id);
        void    transferfunds(const proposal &prop, name dac_id);
        void    check_proposal_can_start(name proposal_id, name dac_id);
        int16_t count_votes(proposal prop, VoteType vote_type, name dac_id);
        void    arbiter_rule_on_proposal(name arbiter, name proposal_id, name dac_id);
        void    _voteprop(name custodian, name proposal_id, name vote, name dac_id);
        bool    is_current_custodian(name custodian, name dac_id);

        TABLE proposalvote {
            uint64_t           vote_id;
            name               voter;
            optional<name>     proposal_id;
            optional<uint64_t> category_id;
            optional<name>     vote;
            optional<name>     delegatee;
            optional<string>   comment_hash;

            uint64_t primary_key() const {
                return vote_id;
            }
            uint64_t voter_key() const {
                return voter.value;
            }

            uint64_t proposal_key() const {
                return proposal_id.value_or(name{0}).value;
            }
            uint64_t category_key() const {
                return category_id.value_or(UINT64_MAX);
            }
            uint128_t get_prop_and_voter() const {
                return combine_ids(proposal_id.value_or(name{0}).value, voter.value);
            }
            uint128_t get_category_and_voter() const {
                return combine_ids(category_id.value_or(UINT64_MAX), voter.value);
            }

            EOSLIB_SERIALIZE(proposalvote, (vote_id)(voter)(proposal_id)(category_id)(vote)(delegatee)(comment_hash))
        };

        using proposal_vote_table = eosio::multi_index<"propvotes"_n, proposalvote,
            indexed_by<"voter"_n, eosio::const_mem_fun<proposalvote, uint64_t, &proposalvote::voter_key>>,
            indexed_by<"proposal"_n, eosio::const_mem_fun<proposalvote, uint64_t, &proposalvote::proposal_key>>,
            indexed_by<"category"_n, eosio::const_mem_fun<proposalvote, uint64_t, &proposalvote::category_key>>,
            indexed_by<"propandvoter"_n,
                eosio::const_mem_fun<proposalvote, uint128_t, &proposalvote::get_prop_and_voter>>,
            indexed_by<"catandvoter"_n,
                eosio::const_mem_fun<proposalvote, uint128_t, &proposalvote::get_category_and_voter>>>;
    };
} // namespace eosdac
