#pragma once

#include <limits>

#include <eosio/eosio.hpp>
#include <eosio/multi_index.hpp>
#include <eosio/permission.hpp>
#include <eosio/singleton.hpp>
#include <eosio/time.hpp>

#include "config.hpp"
#include "contracts-common/safemath.hpp"
#include "contracts-common/serr.hpp"
#include "contracts-common/singleton.hpp"
#include "contracts-common/util.hpp"
#include "daccustodian_shared.hpp"
#include "eosdactokens_shared.hpp"
#include "external_types.hpp"

using namespace std;

namespace eosdac {

    static constexpr eosio::name ONE_PERMISSION    = "one"_n;
    static constexpr eosio::name LOW_PERMISSION    = "low"_n;
    static constexpr eosio::name MEDIUM_PERMISSION = "med"_n;
    static constexpr eosio::name HIGH_PERMISSION   = "high"_n;

#ifndef TRANSFER_DELAY
#define TRANSFER_DELAY 60 * 60
#endif
    struct [[eosio::table("custodians1"), eosio::contract("daccustodian")]] custodian {
        eosio::name           cust_name;
        eosio::asset          requestedpay;
        uint64_t              total_vote_power;
        uint64_t              rank;
        uint32_t              number_voters;
        eosio::time_point_sec avg_vote_time_stamp;

        uint64_t primary_key() const {
            return cust_name.value;
        }

        uint64_t by_votes_rank() const {
            return std::numeric_limits<uint64_t>::max() - total_vote_power;
        }

        uint64_t by_decayed_votes() const {
            return std::numeric_limits<uint64_t>::max() - rank;
        }

        uint64_t by_requested_pay() const {
            return S{requestedpay.amount}.to<uint64_t>();
        }
    };

    using custodians_table = eosio::multi_index<"custodians1"_n, custodian,
        eosio::indexed_by<"byvotesrank"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_votes_rank>>,
        eosio::indexed_by<"bydecayed"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_decayed_votes>>,
        eosio::indexed_by<"byreqpay"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_requested_pay>>>;

    using pending_custodians_table = eosio::multi_index<"pendingcusts"_n, custodian,
        eosio::indexed_by<"byvotesrank"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_votes_rank>>,
        eosio::indexed_by<"bydecayed"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_decayed_votes>>,
        eosio::indexed_by<"byreqpay"_n, eosio::const_mem_fun<custodian, uint64_t, &custodian::by_requested_pay>>>;

    struct [[eosio::table("candidates"), eosio::contract("daccustodian")]] candidate {
        eosio::name           candidate_name;
        eosio::asset          requestedpay;
        uint64_t              rank;
        uint64_t              gap_filler; // Currently unused, can be recycled in the future
        uint64_t              total_vote_power;
        uint8_t               is_active;
        uint32_t              number_voters;
        eosio::time_point_sec avg_vote_time_stamp;
        uint128_t             running_weight_time; // The running sum of weight*time from all votes for this candidate

        uint64_t calc_decayed_votes_index() const {
            auto       err            = Err{"calc_decayed_votes_index"};
            const auto scaling_factor = S{10000.0}; // to improve accuracy of index when converting double to uint64_t

            // log(0) is -infinity, so we always add 1. This does not change the order of the index.
            const auto log_arg = S{total_vote_power} + S{1ull};
            const auto log     = log2(log_arg.to<double>());
            const auto x =
                (S{log} + S{avg_vote_time_stamp.sec_since_epoch()}.to<double>() / S{SECONDS_TO_DOUBLE}.to<double>()) *
                scaling_factor;
            return x.to<uint64_t>();
        }

        uint64_t by_decayed_votes() const {
            return std::numeric_limits<uint64_t>::max() - rank;
        }

        void update_index() {
            rank = calc_decayed_votes_index();
        }

        uint64_t primary_key() const {
            return candidate_name.value;
        }
        uint64_t by_number_votes() const {
            return total_vote_power;
        }
        uint64_t by_votes_rank() const {
            return S{UINT64_MAX} - S{total_vote_power};
        }
        uint64_t by_requested_pay() const {
            return S{requestedpay.amount}.to<uint64_t>();
        }
    };

    using candidates_table = eosio::multi_index<"candidates"_n, candidate,
        eosio::indexed_by<"bycandidate"_n, eosio::const_mem_fun<candidate, uint64_t, &candidate::primary_key>>,
        eosio::indexed_by<"byvotes"_n, eosio::const_mem_fun<candidate, uint64_t, &candidate::by_number_votes>>,
        eosio::indexed_by<"byvotesrank"_n, eosio::const_mem_fun<candidate, uint64_t, &candidate::by_votes_rank>>,
        eosio::indexed_by<"byreqpay"_n, eosio::const_mem_fun<candidate, uint64_t, &candidate::by_requested_pay>>,
        eosio::indexed_by<"bydecayed"_n, eosio::const_mem_fun<candidate, uint64_t, &candidate::by_decayed_votes>>>;

    // candidates2 temporary table
    struct [[eosio::table("candidates2"), eosio::contract("daccustodian")]] candidate2 {
        eosio::name           candidate_name;
        eosio::asset          requestedpay;
        uint64_t              rank;
        uint64_t              gap_filler; // Currently unused, can be recycled in the future
        uint64_t              total_vote_power;
        uint8_t               is_active;
        uint32_t              number_voters;
        eosio::time_point_sec avg_vote_time_stamp;

        uint64_t calc_decayed_votes_index() const {
            auto       err            = Err{"calc_decayed_votes_index"};
            const auto scaling_factor = S{10000.0}; // to improve accuracy of index when converting double to uint64_t

            // log(0) is -infinity, so we always add 1. This does not change the order of the index.
            const auto log_arg = S{total_vote_power} + S{1ull};
            const auto log     = log2(log_arg.to<double>());
            const auto x =
                (S{log} + S{avg_vote_time_stamp.sec_since_epoch()}.to<double>() / S{SECONDS_TO_DOUBLE}.to<double>()) *
                scaling_factor;
            return x.to<uint64_t>();
        }

        uint64_t by_decayed_votes() const {
            return std::numeric_limits<uint64_t>::max() - rank;
        }

        void update_index() {
            rank = calc_decayed_votes_index();
        }

        uint64_t primary_key() const {
            return candidate_name.value;
        }
        uint64_t by_number_votes() const {
            return total_vote_power;
        }
        uint64_t by_votes_rank() const {
            return S{UINT64_MAX} - S{total_vote_power};
        }
        uint64_t by_requested_pay() const {
            return S{requestedpay.amount}.to<uint64_t>();
        }
    };

    using candidates2_table = eosio::multi_index<"candidates2"_n, candidate2,
        eosio::indexed_by<"bycandidate"_n, eosio::const_mem_fun<candidate2, uint64_t, &candidate2::primary_key>>,
        eosio::indexed_by<"byvotes"_n, eosio::const_mem_fun<candidate2, uint64_t, &candidate2::by_number_votes>>,
        eosio::indexed_by<"byvotesrank"_n, eosio::const_mem_fun<candidate2, uint64_t, &candidate2::by_votes_rank>>,
        eosio::indexed_by<"byreqpay"_n, eosio::const_mem_fun<candidate2, uint64_t, &candidate2::by_requested_pay>>,
        eosio::indexed_by<"bydecayed"_n, eosio::const_mem_fun<candidate2, uint64_t, &candidate2::by_decayed_votes>>>;

    //// end of candidates2 temp table

    struct [[eosio::table]] vote_weight {
        eosio::name voter;
        uint64_t    weight;
        uint64_t    weight_quorum;

        uint64_t primary_key() const {
            return voter.value;
        }
    };
    using weights = eosio::multi_index<"weights"_n, vote_weight>;

    struct contr_config {
        //    The amount of assets that are locked up by each candidate applying for election.
        eosio::extended_asset lockupasset;
        //    The maximum number of votes that each member can make for a candidate.
        uint8_t maxvotes = 5;
        //    Number of custodians to be elected for each election count.
        uint8_t numelected = 3;
        //    Length of a period in seconds.
        //     - used for pay calculations if an eary election is called and to trigger deferred `newperiod` calls.
        uint32_t periodlength = 7 * 24 * 60 * 60;

        // Length of time in seconds for the pending period. This is the time between the election and when the new
        // custodians take over.
        uint32_t pending_period_delay = 5 * 60;

        // The contract will direct all payments via the service provider.
        bool should_pay_via_service_provider;

        // Amount of token value in votes required to trigger the initial set of custodians
        uint32_t initial_vote_quorum_percent;

        // Amount of token supply required to trigger the initial set of custodians
        uint64_t token_supply_theshold = 1000 * 10000;

        // Amount of token value in votes required to trigger the allow a new set of custodians to be set after the
        // initial threshold has been achieved.
        uint32_t vote_quorum_percent;

        // required number of custodians required to approve different levels of authenticated actions.
        uint8_t auth_threshold_high;
        uint8_t auth_threshold_mid;
        uint8_t auth_threshold_low;

        // The time before locked up stake can be released back to the candidate using the unstake action
        uint32_t lockup_release_time_delay;

        eosio::extended_asset requested_pay_max;
    };

    struct [[eosio::table("votes"), eosio::contract("daccustodian")]] vote {
        name                  voter;
        name                  proxy;
        std::vector<name>     candidates;
        eosio::time_point_sec vote_time_stamp;
        uint8_t               vote_count; // wraps around automatically if > 255

        uint64_t primary_key() const {
            return voter.value;
        }

        uint64_t by_proxy() const {
            return proxy.value;
        }
    };

    using votes_table =
        eosio::multi_index<"votes"_n, vote, indexed_by<"byproxy"_n, const_mem_fun<vote, uint64_t, &vote::by_proxy>>>;

    struct [[eosio::table("proxies"), eosio::contract("daccustodian")]] proxy {
        name    proxy;
        int64_t total_weight;

        uint64_t primary_key() const {
            return proxy.value;
        }
    };

    using proxies_table = eosio::multi_index<"proxies"_n, proxy>;

    struct [[eosio::table("pendingpay"), eosio::contract("daccustodian")]] pay {
        uint64_t       key;
        name           receiver;
        extended_asset quantity;

        static checksum256 getIndex(const name &receiver, const extended_symbol &symbol) {
            return combine_ids(receiver.value, symbol.get_contract().value, symbol.get_symbol().code().raw(), 0);
        }

        uint64_t primary_key() const {
            return key;
        }
        uint64_t byreceiver() const {
            return receiver.value;
        }
        checksum256 byreceiver_and_symbol() const {
            return getIndex(receiver, quantity.get_extended_symbol());
        }

        EOSLIB_SERIALIZE(pay, (key)(receiver)(quantity))
    };

    using pending_pay_table =
        multi_index<"pendingpay"_n, pay, indexed_by<"byreceiver"_n, const_mem_fun<pay, uint64_t, &pay::byreceiver>>,
            indexed_by<"receiversym"_n, const_mem_fun<pay, checksum256, &pay::byreceiver_and_symbol>>>;

    struct [[eosio::table("candperms"), eosio::contract("daccustodian")]] candperm {
        name cand;
        name permission;

        uint64_t primary_key() const {
            return cand.value;
        }
    };

    using candperms_table = multi_index<"candperms"_n, candperm>;

    struct [[eosio::table("whitelist"), eosio::contract("daccustodian")]] whitelist {
        name     cand;
        uint64_t rating;

        uint64_t primary_key() const {
            return cand.value;
        }
    };

    using whitelist_table = eosio::multi_index<"whitelist"_n, whitelist>;

    // clang-format off
    SINGLETON(dacglobals, daccustodian, 
            PROPERTY_OPTIONAL_TYPECASTING(uint16_t, uint32_t, budget_percentage); // No longer needed. Use prop_budget_percentage and remaining budget is derived from the total balance.
            PROPERTY_OPTIONAL_TYPECASTING(uint16_t, uint32_t, prop_budget_percentage);
            PROPERTY(time_point_sec, lastclaimbudgettime); 
            PROPERTY(int64_t, total_weight_of_votes);
            PROPERTY(bool, met_initial_votes_threshold); 
            PROPERTY(uint32_t, number_active_candidates);
            PROPERTY(int64_t, total_votes_on_candidates); 
            PROPERTY(eosio::time_point_sec, lastperiodtime);
            PROPERTY(eosio::time_point_sec, pending_period_time);
            PROPERTY(eosio::extended_asset, lockupasset); 
            PROPERTY(uint8_t, maxvotes); 
            PROPERTY(uint8_t, numelected);
            PROPERTY(uint32_t, periodlength); 
            PROPERTY(uint32_t, pending_period_delay); 
            PROPERTY(bool, should_pay_via_service_provider);
            PROPERTY(uint32_t, initial_vote_quorum_percent); 
            PROPERTY(uint32_t, vote_quorum_percent);
            PROPERTY(uint8_t, auth_threshold_high); 
            PROPERTY(uint8_t, auth_threshold_mid);
            PROPERTY(uint8_t, auth_threshold_low); 
            PROPERTY(uint32_t, lockup_release_time_delay);
            PROPERTY(eosio::extended_asset, requested_pay_max); 
            PROPERTY(uint64_t, token_supply_theshold);
            PROPERTY(bool, maintenance_mode);
            PROPERTY_OPTIONAL_TYPECASTING(bool, bool, requires_whitelist);
            PROPERTY_OPTIONAL_TYPECASTING(asset, asset, prop_budget_amount);
            PROPERTY_OPTIONAL_TYPECASTING(asset, asset, spendings_budget_amount);
    )
    // clang-format on

    class daccustodian : public contract {

      public:
        daccustodian(name s, name code, datastream<const char *> ds) : contract(s, code, ds) {}

#ifdef IS_DEV
        ACTION updateconfige(const contr_config &new_config, const name &dac_id);
#endif
        // ACTION transferobsv(name from, name to, asset quantity, name dac_id);
        ACTION balanceobsv(const vector<account_balance_delta> &account_balance_deltas, const name &dac_id);
        ACTION stakeobsv(const vector<account_stake_delta> &account_stake_deltas, const name &dac_id);
        ACTION weightobsv(const vector<account_weight_delta> &account_weight_deltas, const name &dac_id);

        ACTION nominatecane(const name &cand, const eosio::asset &requestedpay, const name &dac_id);
        ACTION nominate(const name &cand, const name &dac_id);
        ACTION withdrawcane(const name &cand, const name &dac_id);
        ACTION removecand(const name &cand, const name &dac_id);
        ACTION firecand(const name &cand, const bool lockupStake, const name &dac_id);
        ACTION resigncust(const name &cust, const name &dac_id);
        ACTION firecust(const name &cust, const name &dac_id);
        ACTION appointcust(const vector<name> &cust, const name &dac_id);
        ACTION updatebio(const name &cand, const std::string &bio, const name &dac_id);
        ACTION flagcandprof(
            const name &cand, const std::string &reason, const name &reporter, const bool block, const name &dac_id);

        ACTION stprofile(const name &cand, const std::string &profile, const name &dac_id);

        ACTION updatereqpay(const name &cand, const eosio::asset &requestedpay, const name &dac_id);
        ACTION votecust(const name &voter, const std::vector<name> &newvotes, const name &dac_id);
        ACTION removecstvte(const name &voter, const name &dac_id);
        ACTION voteproxy(const name &voter, const name &proxy, const name &dac_id);
        ACTION regproxy(const name &proxy, const name &dac_id);
        ACTION unregproxy(const name &proxy, const name &dac_id);
        ACTION newperiod(const std::string &message, const name &dac_id);
        ACTION runnewperiod(const std::string &message, const name &dac_id);
        ACTION claimpay(const uint64_t payid, const name &dac_id);
        ACTION removecuspay(const uint64_t payid, const name &dac_id);
        ACTION rejectcuspay(const uint64_t payid, const name &dac_id);
        ACTION paycpu(const name &dac_id);
        ACTION claimbudget(const name &dac_id);
        ACTION setlockasset(const eosio::extended_asset &lockupasset, const name &dac_id);
        ACTION setperiodlen(const uint32_t &periodlength, const name &dac_id);
        ACTION setpenddelay(const uint32_t &pending_period_delay, const name &dac_id);
        ACTION setpayvia(const bool &should_pay_via_service_provider, const name &dac_id);
        ACTION setinitvote(const uint32_t &initial_vote_quorum_percent, const name &dac_id);
        ACTION setvotequor(const uint32_t &vote_quorum_percent, const name &dac_id);
        ACTION setdaogov(
            const uint8_t &maxvotes, const uint8_t &numelected, const uint8_t &auththreshold, const name &dac_id);
        ACTION setlockdelay(const uint32_t &lockup_release_time_delay, const name &dac_id);
        ACTION setpaymax(const eosio::extended_asset &requested_pay_max, const name &dac_id);
        ACTION settokensup(const uint64_t &token_supply_theshold, const name &dac_id);
        ACTION setbudget(const name &dac_id, const uint16_t percentage);
        ACTION setprpbudget(const name &dac_id, const uint16_t percentage);
        ACTION setprpbudga(const name &dac_id, const asset &amount);
        ACTION setspendbudg(const name &dac_id, const asset &amount);
        ACTION unsetbudget(const name &dac_id);
        ACTION setrequirewl(const name &dac_id, bool required);
        ACTION addwl(name cand, uint64_t rating, name dac_id);
        ACTION updwl(name cand, uint64_t rating, name dac_id);
        ACTION rmvwl(name cand, name dac_id);

#ifdef DEBUG
        ACTION migratestate(const name &dac_id);
        ACTION resetvotes(const name &voter, const name &dac_id);
        ACTION collectvotes(const name &dac_id, name from, name to);
        ACTION resetcands(const name &dac_id);
        ACTION resetstate(const name &dac_id);
        ACTION clearcands(const name &dac_id);
        ACTION clearcusts(const name &dac_id);
        // Remove all votes that delegate to a proxy for the given DAC
        ACTION clrprxvotes(const name &dac_id);
        // Erase all registered proxy records for the given DAC
        ACTION clrproxies(const name &dac_id);
        // Clean up orphaned votes - removes candidate references that no longer exist in candidates table
        ACTION cleanorphans(const name &dac_id, name from, name to);
        ACTION maintenance(const bool maintenance);
#endif

#if defined(IS_DEV) || defined(DEBUG)
        ACTION migraterank(const name &dac_id);
        ACTION clearrank(const name &dac_id);
#endif

#ifdef IS_DEV
        ACTION fillstate(const name &dac_id);

        // helper function for testing to add custodian to custodians table without the need for elections
        ACTION tstaddcust(const name cust, const name dac_id) {
            require_auth(get_self());
            auto custodians = custodians_table{get_self(), dac_id.value};
            custodians.emplace(get_self(), [&](auto &c) {
                c.cust_name    = cust;
                c.requestedpay = ZERO_TRILIUM;
            });
        };

#endif

        /**
         * This action is used to register a custom permission that will be used in the multisig instead of active.
         *
         * ### Assertions:
         * - The account supplied to cand exists and is a registered candidate
         * - The permission supplied exists as a permission on the account
         *
         * @param cand - The account id for the candidate setting a custom permission.
         * @param permission - The permission name to use.
         *
         *
         * ### Post Condition:
         * The candidate will have a record entered into the database indicating the custom permission to use.
         */
        ACTION setperm(const name &cand, const name &permission, const name &dac_id);

      private: // Private helper methods used by other actions.
        void updateVoteWeight(
            name custodian, const time_point_sec vote_time_stamp, int64_t weight, name dac_id, bool from_voting);
        void updateVoteWeights(const vector<name> &votes, const time_point_sec vote_time_stamp, int64_t vote_weight,
            name internal_dac_id, bool from_voting);
        std::pair<int64_t, int64_t> get_vote_weight(name voter, name dac_id);
        void                        modifyVoteWeights(const account_weight_delta &awd, const vector<name> &oldVotes,
                                   const std::optional<time_point_sec> &oldVoteTimestamp, const vector<name> &newVotes,
                                   time_point_sec new_time_stamp, const name dac_id, const bool from_voting);
        void modifyProxiesWeight(int64_t vote_weight, name oldProxy, name newProxy, name dac_id, bool from_voting);
        void assertPeriodTime(const dacglobals &globals);
        void assertPendingPeriodTime(const dacglobals &globals);
        void distributeMeanPay(name internal_dac_id);
        vector<eosiosystem::permission_level_weight> get_perm_level_weights(
            const custodians_table &custodians, const name &dac_id);
        void add_all_auths(const name &accountToChange, const vector<eosiosystem::permission_level_weight> &weights,
            const name &dac_id, const bool msig = false);
        void add_all_auths_msig(
            const name &accountToChange, vector<eosiosystem::permission_level_weight> &weights, const name &dac_id);
        void add_auth_to_account(const name &accountToChange, const uint8_t threshold, const name &permission,
            const name &parent, vector<eosiosystem::permission_level_weight> weights, const bool msig = false);
        void setMsigAuths(name dac_id);
        void transferCustodianBudget(const dacdir::dac &dac);
        void removeCustodian(name cust, name internal_dac_id);
        void disableCandidate(name cust, name internal_dac_id);
        void prepareCustodians(name internal_dac_id);
        bool periodIsPending(name internal_dac_id);
        void allocateCustodians(name internal_dac_id);
        bool permissionExists(name account, name permission);
        bool _check_transaction_authorization(const char *trx_data, uint32_t trx_size, const char *pubkeys_data,
            uint32_t pubkeys_size, const char *perms_data, uint32_t perms_size);

        permission_level getCandidatePermission(name account, name internal_dac_id);
        void             validateUnstake(name code, name cand, name dac_id);
        void validateUnstakeAmount(const name &code, const name &cand, const asset &unstake_amount, const name &dac_id);
        void validateMinStake(name account, name dac_id);
        void update_number_of_votes(const vector<name> &oldvotes, const vector<name> &newvotes, const name &dac_id);

        bool maintenance_mode() {
            const auto globals = dacglobals{get_self(), get_self()};
            return globals.get_maintenance_mode();
        }
    };
}; // namespace eosdac
