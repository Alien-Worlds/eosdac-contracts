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
            ProposalStateCompleted                  = STATE_COMPLETED.value
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

        ACTION createprop(name proposer, string title, string summary, name arbiter, extended_asset proposal_pay,
            extended_asset arbiter_pay, string content_hash, name id, uint16_t category, uint32_t job_duration,
            name dac_id);

        ACTION voteprop(name custodian, name proposal_id, name vote, name dac_id);
        ACTION votepropfin(name custodian, name proposal_id, name vote, name dac_id);

        ACTION delegatevote(name custodian, name proposal_id, name delegatee_custodian, name dac_id);
        ACTION delegatecat(name custodian, uint64_t category, name delegatee_custodian, name dac_id);
        ACTION undelegateca(name custodian, uint64_t category, name dac_id);
        ACTION arbagree(name arbiter, name proposal_id, name dac_id);
        ACTION arbapprove(name arbiter, name proposal_id, name dac_id);
        ACTION arbdeny(name arbiter, name proposal_id, name dac_id);
        ACTION startwork(name proposal_id, name dac_id);
        ACTION completework(name proposal_id, name dac_id);
        ACTION finalize(name proposal_id, name dac_id);
        ACTION cancelprop(name proposal_id, name dac_id);
        ACTION cancelwip(name proposal_id, name dac_id);
        ACTION dispute(name proposal_id, name dac_id);
        ACTION comment(name commenter, name proposal_id, string comment, string comment_category, name dac_id);
        ACTION updateconfig(config new_config, name dac_id);
        // ACTION clearconfig(name dac_id);
        ACTION clearexpprop(name proposal_id, name dac_id);
        ACTION rmvcompleted(name proposal_id, name dac_id);
        ACTION updpropvotes(name proposal_id, name dac_id);
        ACTION setpropfee(extended_asset new_proposal_fee, name dac_id);
        ACTION refund(name account);
        ACTION addarbwl(name arbiter, uint64_t rating, name dac_id);
        ACTION updarbwl(name arbiter, uint64_t rating, name dac_id);
        ACTION rmvarbwl(name arbiter, name dac_id);
        // Same as rmvarbwl but verifies that the arbiter is not an arbiter on a live proposal
        ACTION safermvarbwl(name arbiter, name dac_id);

        ACTION addrecwl(name cand, uint64_t rating, name dac_id);
        ACTION updrecwl(name cand, uint64_t rating, name dac_id);
        ACTION rmvrecwl(name cand, name dac_id);

        [[eosio::on_notify("*::transfer")]] void receive(name from, name to, asset quantity, string memo);
        ACTION                                   minduration(uint32_t new_min_proposal_duration, name dac_id);

      private:
        void    clearprop(const proposal &proposal, name dac_id);
        void    transferfunds(const proposal &prop, name dac_id);
        void    check_proposal_can_start(name proposal_id, name dac_id);
        int16_t count_votes(proposal prop, VoteType vote_type, name dac_id);
        void    arbiter_rule_on_proposal(name arbiter, name proposal_id, name dac_id);
        void    _voteprop(name custodian, name proposal_id, name vote, name dac_id);

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
