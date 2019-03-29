#include <eosiolib/eosio.hpp>
#include <eosiolib/action.hpp>
#include "dacproposals.hpp"
#include <eosiolib/time.hpp>
#include <typeinfo>

#include <string>

using namespace eosio;
using namespace std;

    ACTION dacproposals::createprop(name proposer, string title, string summary, name arbitrator, extended_asset pay_amount, string content_hash, uint64_t id, uint16_t category, name dac_scope){
        require_auth(proposer);
        assertValidMember(proposer, dac_scope);
        proposal_table proposals(_self, dac_scope.value);

        eosio_assert(proposals.find(id) == proposals.end(), "ERR::CREATEPROP_DUPLICATE_ID::A Proposal with the id already exists. Try again with a different id.");

        eosio_assert(title.length() > 3, "ERR::CREATEPROP_SHORT_TITLE::Title length is too short.");
        eosio_assert(summary.length() > 3, "ERR::CREATEPROP_SHORT_SUMMARY::Summary length is too short.");
        eosio_assert(pay_amount.quantity.symbol.is_valid(), "ERR::CREATEPROP_INVALID_SYMBOL::Invalid pay amount symbol.");
        eosio_assert(pay_amount.quantity.amount > 0, "ERR::CREATEPROP_INVALID_PAY_AMOUNT::Invalid pay amount. Must be greater than 0.");
        eosio_assert(is_account(arbitrator), "ERR::CREATEPROP_INVALID_ARBITRATOR::Invalid arbitrator.");

        proposals.emplace(proposer, [&](proposal &p) {
            p.key = id;
            p.proposer = proposer;
            p.arbitrator = arbitrator;
            p.content_hash = content_hash;
            p.pay_amount = pay_amount;
            p.state = pending_approval;
            p.category = category;
            p.expiry = time_point_sec(now()) + current_configs(dac_scope).approval_expiry;   
        });
    }

    ACTION dacproposals::voteprop(name custodian, uint64_t proposal_id, uint8_t vote, name dac_scope) {
        require_auth(custodian);
        require_auth(current_configs(dac_scope).authority_account);
        assertValidMember(custodian, dac_scope);

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::VOTEPROP_PROPOSAL_NOT_FOUND::Proposal not found.﻿");
        switch (prop.state) {
            case pending_approval:
                eosio_assert(vote == proposal_approve || vote == proposal_deny, "ERR::VOTEPROP_INVALID_VOTE::Invalid vote for the current proposal state.");
                break;
            case pending_finalize:
                eosio_assert(vote == finalize_approve || vote == finalize_deny, "ERR::VOTEPROP_INVALID_VOTE::Invalid vote for the current proposal state.");
                break;
            default:
                eosio_assert(false, "ERR::VOTEPROP_INVALID_PROPOSAL_STATE::Invalid proposal state to accept votes.");
        }
        
        proposal_vote_table prop_votes(_self, dac_scope.value);
        auto by_prop_and_voter = prop_votes.get_index<"propandvoter"_n>();
        uint128_t joint_id = dacproposals::combine_ids(proposal_id, custodian.value);
        auto vote_idx = by_prop_and_voter.find(joint_id);
        if (vote_idx == by_prop_and_voter.end()) {
            prop_votes.emplace(_self, [&](proposalvote &v) {
                v.vote_id = prop_votes.available_primary_key();
                v.proposal_id = proposal_id;
                v.voter = custodian;
                v.vote = vote;
                v.delegatee = name{0};
            });
        } else {
            by_prop_and_voter.modify(vote_idx, _self, [&](proposalvote &v) {
                v.vote = vote;
                v.delegatee = name{0};
            });
        }
    }

    ACTION dacproposals::delegatevote(name custodian, uint64_t proposal_id, name dalegatee_custodian, name dac_scope) {
        require_auth(custodian);
        require_auth(current_configs(dac_scope).authority_account);
        assertValidMember(custodian, dac_scope);
        eosio_assert(custodian != dalegatee_custodian, "ERR::DELEGATEVOTE_DELEGATE_SELF::Cannot delegate voting to yourself.");

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");

        proposal_vote_table prop_votes(_self, dac_scope.value);
        auto by_prop_and_voter = prop_votes.get_index<"propandvoter"_n>();
        uint128_t joint_id = dacproposals::combine_ids(proposal_id, custodian.value);
        auto vote_idx = by_prop_and_voter.find(joint_id);
        if (vote_idx == by_prop_and_voter.end()) {
            prop_votes.emplace(_self, [&](proposalvote &v) {
                v.vote_id = prop_votes.available_primary_key();
                v.proposal_id = proposal_id;
                v.voter = custodian;
                v.vote = none;
                v.delegatee = dalegatee_custodian;
            });
        } else {
            by_prop_and_voter.modify(vote_idx, _self, [&](proposalvote &v) {
                v.vote = none;
                v.delegatee = dalegatee_custodian;
            });
        }
    }

    ACTION dacproposals::arbapprove(name arbitrator, uint64_t proposal_id, name dac_scope) {
        require_auth(arbitrator);
        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");
        clearprop(prop, dac_scope);
    }

    ACTION dacproposals::startwork(uint64_t proposal_id, name dac_scope){

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");

        eosio_assert(prop.state == pending_approval, "ERR::STARTWORK_WRONG_STATE::Proposal not found.Proposal is not in the pending approval state therefore cannot start work.");
        
        time_point_sec time_now = time_point_sec(now());
        if (prop.has_expired(time_now)) {
            print_f("The proposal with proposal_id: % has expired and will now be removed.", proposal_id);
            clearprop(prop, dac_scope);
            return;
        }
        
        require_auth(prop.proposer);
        assertValidMember(prop.proposer, dac_scope);

        custodians_table custodians("daccustodian"_n, "daccustodian"_n.value);
        proposal_vote_table prop_votes(_self, dac_scope.value);

        std::set<eosio::name> current_custodians;

        for(custodian cust: custodians) {
            current_custodians.insert(cust.cust_name);
        }

        auto by_voters = prop_votes.get_index<"proposal"_n>();
        std::map<eosio::name, uint16_t> delegated_votes;
        std::set<eosio::name> approval_votes;

        auto vote_idx = by_voters.find(proposal_id);

        while(vote_idx != by_voters.end() && vote_idx->proposal_id == proposal_id) {
            if (current_custodians.find(vote_idx->voter) != current_custodians.end()) {
                if (vote_idx->delegatee != name{0} && 
                    current_custodians.find(vote_idx->delegatee) != current_custodians.end()) {
                        delegated_votes[vote_idx->delegatee]++;
                } else if (vote_idx->vote == proposal_approve) {
                        approval_votes.insert(vote_idx->voter);
                }
            }
            vote_idx++;
        }
        
        int16_t approved_count = 0;
        for(auto approval : approval_votes) {
            approved_count++;
            approved_count += delegated_votes[approval];
        }
        print_f("Worker proposal % was approved to start work with: % votes\n", vote_idx->proposal_id, approved_count);
        config configs = current_configs(dac_scope);

        eosio_assert(approved_count >= configs.proposal_threshold, "ERR::STARTWORK_INSUFFICIENT_VOTES::Insufficient votes on worker proposal.");
        proposals.modify(prop, prop.proposer, [&](proposal &p){
            p.state = work_in_progress;
        });

        // print("Transfer funds to escrow account");
        string memo = prop.proposer.to_string() + ":" + to_string(proposal_id) + ":" + prop.content_hash;

        auto inittuple = make_tuple(configs.treasury_account, prop.proposer, prop.arbitrator, time_now + configs.escrow_expiry, memo, std::optional<uint64_t>(proposal_id));

        eosio::action(
                eosio::permission_level{configs.treasury_account , "active"_n },
                configs.service_account, "init"_n,
                inittuple
        ).send();

        eosio::action(
                eosio::permission_level{configs.treasury_account , "xfer"_n },
                prop.pay_amount.contract, "transfer"_n,
                make_tuple(configs.treasury_account, configs.service_account, prop.pay_amount.quantity, "payment for wp: " + to_string(proposal_id))
        ).send();
    }

    ACTION dacproposals::completework(uint64_t proposal_id, name dac_scope){

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");

        require_auth(prop.proposer);
        assertValidMember(prop.proposer, dac_scope);
        eosio_assert(prop.state == work_in_progress, "ERR::COMPLETEWORK_WRONG_STATE::Worker proposal can only be completed from work_in_progress state");

        proposals.modify(prop, prop.proposer, [&](proposal &p){
            p.state = pending_finalize;
        });
    }

    ACTION dacproposals::finalize(uint64_t proposal_id, name dac_scope) {

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");

        eosio_assert(prop.state == pending_finalize, "ERR::FINALIZE_WRONG_STATE::Proposal is not in the pending_finalize state therefore cannot be finalized.");
        
        custodians_table custodians("daccustodian"_n, "daccustodian"_n.value);
        std::set<eosio::name> current_custodians;
        for(custodian cust: custodians) {
            current_custodians.insert(cust.cust_name);
        }
        
        proposal_vote_table prop_votes(_self, dac_scope.value);

        auto by_voters = prop_votes.get_index<"proposal"_n>();

        std::map<eosio::name, uint16_t> delegated_votes;
        std::set<eosio::name> approval_votes;

        auto vote_idx = by_voters.find(proposal_id);

        while(vote_idx != by_voters.end() && vote_idx->proposal_id == proposal_id) {
            if (current_custodians.find(vote_idx->voter) != current_custodians.end()) {
                if (vote_idx->delegatee != name{0} && 
                    current_custodians.find(vote_idx->delegatee) != current_custodians.end()) {
                        delegated_votes[vote_idx->delegatee]++;
                } else if (vote_idx->vote == finalize_approve  ) {
                        approval_votes.insert(vote_idx->voter);
                }
            }
            vote_idx++;
        }
        
        int16_t approved_count = 0;
        for(auto approval : approval_votes) {
            approved_count++;
            approved_count += delegated_votes[approval];
        }

        print_f("Worker proposal % was approved for finalizing with: % votes\n", vote_idx->proposal_id, approved_count);

        eosio_assert(approved_count >= current_configs(dac_scope).finalize_threshold, "ERR::FINALIZE_INSUFFICIENT_VOTES::Insufficient votes on worker proposal to be finalized.");

        transferfunds(prop, dac_scope);
    }

    ACTION dacproposals::cancel(uint64_t proposal_id, name dac_scope) {
        
        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");
        require_auth(prop.proposer);
        assertValidMember(prop.proposer, dac_scope);
        clearprop(prop, dac_scope);
    }

    ACTION dacproposals::comment(name commenter, uint64_t proposal_id, string comment, string comment_category, name dac_scope) {
        require_auth(commenter);
        assertValidMember(commenter, dac_scope);

        proposal_table proposals(_self, dac_scope.value);

        const proposal& prop = proposals.get(proposal_id, "ERR::DELEGATEVOTE_PROPOSAL_NOT_FOUND::Proposal not found.");
        if (!has_auth(prop.proposer)) {
            require_auth(current_configs(dac_scope).authority_account);
        }
    }

    ACTION dacproposals::updateconfig(config new_config, name dac_scope) {

        if (current_configs(dac_scope).authority_account == name{0}) {
            require_auth(_self);
        } else {
            require_auth(current_configs(dac_scope).authority_account);
        }
        configs_table configs(_self, dac_scope.value);
        configs.set(new_config, _self);
    }

//    Private methods
    void dacproposals::transferfunds(const proposal &prop, name dac_scope) {
        proposal_table proposals(_self, dac_scope.value);
        config configs = current_configs(dac_scope);

        eosio::action(
                eosio::permission_level{configs.treasury_account, "active"_n },
                configs.service_account, "approveext"_n,
                make_tuple( prop.key, configs.treasury_account)
            ).send();

        clearprop(prop, dac_scope);
    }

    void dacproposals::clearprop(const proposal& proposal, name dac_scope){

        proposal_table proposals(_self, dac_scope.value);

        // Remove all the votes associated with that proposal.
        proposal_vote_table prop_votes(_self, dac_scope.value);
        auto by_voters = prop_votes.get_index<"proposal"_n>();
        auto itr = by_voters.find(proposal.key);
        while(itr != by_voters.end()) {
            print(itr->voter);
            itr = by_voters.erase(itr);
        }
        auto prop_to_erase = proposals.find(proposal.key);
        
        proposals.erase(prop_to_erase);
    }

    void dacproposals::assertValidMember(name member, name dac_scope) {
    name member_terms_account = current_configs(dac_scope).member_terms_account;
    regmembers reg_members(member_terms_account, member_terms_account.value);
    memterms memberterms(member_terms_account, member_terms_account.value);

    const auto &regmem = reg_members.get(member.value, "ERR::GENERAL_REG_MEMBER_NOT_FOUND::Account is not registered with members.");
    eosio_assert((regmem.agreedterms != 0), "ERR::GENERAL_MEMBER_HAS_NOT_AGREED_TO_ANY_TERMS::Account has not agreed to any terms");
    auto latest_member_terms = (--memberterms.end());
    eosio_assert(latest_member_terms->version == regmem.agreedterms, "ERR::GENERAL_MEMBER_HAS_NOT_AGREED_TO_LATEST_TERMS::Agreed terms isn't the latest.");
}

EOSIO_DISPATCH(dacproposals,
                (createprop)
                (startwork)
                (completework)
                (voteprop)
                (delegatevote)
                (finalize)
                (cancel)
                (comment)
                (updateconfig)
        )
