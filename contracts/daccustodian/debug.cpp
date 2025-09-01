
void daccustodian::resetvotes(const name &voter, const name &dac_id) {
    require_auth(get_self());
    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running resetvotes");
    votes_table votes_cast_by_members(_self, dac_id.value);
    auto        existingVote = votes_cast_by_members.find(voter.value);

    check(existingVote != votes_cast_by_members.end(), "No votes");
}

void daccustodian::collectvotes(const name &dac_id, name from, name to) {
    require_auth(get_self());
    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running collectvotes");

    votes_table votes_cast_by_members(_self, dac_id.value);
    auto        vote_ittr = votes_cast_by_members.lower_bound(from.value);

    do {
        update_number_of_votes({}, vote_ittr->candidates, dac_id);
        const auto [vote_weight, vote_weight_quorum] = get_vote_weight(vote_ittr->voter, dac_id);
        modifyVoteWeights({vote_ittr->voter, vote_weight, vote_weight_quorum}, {}, {}, vote_ittr->candidates,
            vote_ittr->vote_time_stamp, dac_id, true);
        vote_ittr++;
    } while (vote_ittr != votes_cast_by_members.end() && vote_ittr->voter != to);
}

void daccustodian::resetstate(const name &dac_id) {
    require_auth(get_self());
    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running resetstate");

    auto currentState = dacglobals{get_self(), dac_id};

    currentState.set_total_weight_of_votes(0);
    currentState.set_total_votes_on_candidates(0);
    // currentState.set_number_active_candidates(0);
    // currentState.set_met_initial_votes_threshold(false);
}

void daccustodian::resetcands(const name &dac_id) {
    require_auth(get_self());
    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running resetcands");
    candidates_table candidates(_self, dac_id.value);
    auto             cand = candidates.begin();

    while (cand != candidates.end()) {
        candidates.modify(cand, same_payer, [&](candidate &c) {
            c.total_vote_power = 0;
            c.number_voters    = 0;
            // c.is_active           = 0;
            c.avg_vote_time_stamp = eosio::time_point_sec();
            c.running_weight_time = 0;
            c.update_index();
        });

        cand++;
    }
}

void daccustodian::clearcands(const name &dac_id) {
    require_auth(get_self());

    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running clearcands");
    candidates_table candidates(_self, dac_id.value);
    auto             cand = candidates.begin();

    while (cand != candidates.end()) {
        cand = candidates.erase(cand);
    }
}

void daccustodian::clearcusts(const name &dac_id) {
    require_auth(get_self());

    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running clearcusts");

    custodians_table custodians(_self, dac_id.value);

    auto cust = custodians.begin();

    while (cust != custodians.end()) {
        cust = custodians.erase(cust);
    }
}

void daccustodian::maintenance(const bool maintenance) {
    require_auth(get_self());

    auto globals = dacglobals{get_self(), get_self()};
    globals.set_maintenance_mode(maintenance);
}

// -------------------------------------------------------------------------------------------------
//  DEBUG helpers for removing proxy-related data
// -------------------------------------------------------------------------------------------------

void daccustodian::clrprxvotes(const name &dac_id) {
    // Only contract account itself can run destructive maintenance helpers.
    require_auth(get_self());

    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running clrprxvotes");

    votes_table votes_cast_by_members(_self, dac_id.value);

    auto vote_itr = votes_cast_by_members.begin();
    while (vote_itr != votes_cast_by_members.end()) {
        if (vote_itr->proxy.value != 0) {
            vote_itr = votes_cast_by_members.erase(vote_itr);
        } else {
            vote_itr++;
        }
    }
}

void daccustodian::clrproxies(const name &dac_id) {
    require_auth(get_self());

    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running clrproxies");

    proxies_table proxies(_self, dac_id.value);

    auto proxy_itr = proxies.begin();
    while (proxy_itr != proxies.end()) {
        proxy_itr = proxies.erase(proxy_itr);
    }
}

void daccustodian::cleanorphans(const name &dac_id, name from, name to) {
    require_auth(get_self());

    check(maintenance_mode(), "ERR::NOT_MAINTENANCE_MODE::Must enable maintenance mode before running cleanorphans");

    votes_table votes_cast_by_members(_self, dac_id.value);
    candidates_table candidates(_self, dac_id.value);

    // Build a set of existing candidate names for fast lookup
    std::set<name> existing_candidates;
    for (const auto& candidate : candidates) {
        existing_candidates.insert(candidate.candidate_name);
    }


    auto vote_itr = votes_cast_by_members.lower_bound(from.value);

    do {
        std::vector<name> valid_candidates;
        uint32_t orphaned_count = 0;

        // Check each candidate in this vote
        for (const auto& candidate_name : vote_itr->candidates) {
            if (existing_candidates.find(candidate_name) != existing_candidates.end()) {
                // Candidate exists, keep it
                valid_candidates.push_back(candidate_name);
            } else {
                // Candidate is orphaned, count it
                orphaned_count++;
            }
        }

        if (valid_candidates.empty()) {
            // All candidates were orphaned, remove the entire vote
            vote_itr = votes_cast_by_members.erase(vote_itr);
        } else if (orphaned_count > 0) {
            // Some candidates were orphaned, update the vote with only valid candidates
            votes_cast_by_members.modify(vote_itr, same_payer, [&](auto &v) {
                v.candidates = valid_candidates;
            });
            vote_itr++;
        } else {
            // No orphaned candidates, move to next vote
            vote_itr++;
        }
    } while (vote_itr != votes_cast_by_members.end() && vote_itr->voter != to);

}
