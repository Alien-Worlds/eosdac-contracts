
void daccustodian::resetvotes(const name &voter, const name &dac_id) {
    require_auth(get_self());

    votes_table votes_cast_by_members(_self, dac_id.value);
    auto        existingVote = votes_cast_by_members.find(voter.value);

    check(existingVote != votes_cast_by_members.end(), "No votes");
}

void daccustodian::collectvotes(const name &dac_id, name from, name to) {
    require_auth(get_self());

    votes_table votes_cast_by_members(_self, dac_id.value);
    auto        vote_ittr = votes_cast_by_members.lower_bound(from.value);

    while (vote_ittr != votes_cast_by_members.end() && vote_ittr->voter != to) {
        update_number_of_votes({}, vote_ittr->candidates, dac_id);
        const auto [vote_weight, vote_weight_quorum] = get_vote_weight(vote_ittr->voter, dac_id);
        modifyVoteWeights({vote_ittr->voter, vote_weight, vote_weight_quorum}, {}, {}, vote_ittr->candidates,
            vote_ittr->vote_time_stamp, dac_id, true);
        vote_ittr++;
    }
}

void daccustodian::resetstate(const name &dac_id) {
    require_auth(get_self());
    auto currentState = dacglobals{get_self(), dac_id};

    currentState.set_total_weight_of_votes(0);
    currentState.set_total_votes_on_candidates(0);
    // currentState.set_number_active_candidates(0);
    // currentState.set_met_initial_votes_threshold(false);
}

void daccustodian::resetcands(const name &dac_id) {
    require_auth(get_self());

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

    candidates_table candidates(_self, dac_id.value);
    auto             cand = candidates.begin();

    while (cand != candidates.end()) {
        cand = candidates.erase(cand);
    }
}

void daccustodian::clearcusts(const name &dac_id) {
    require_auth(get_self());

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
        vote_itr = votes_cast_by_members.erase(vote_itr);
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
