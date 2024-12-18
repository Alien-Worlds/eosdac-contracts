using namespace eosdac;

void daccustodian::distributeMeanPay(name dac_id) {
    custodians_table  custodians(get_self(), dac_id.value);
    pending_pay_table pending_pay(get_self(), dac_id.value);
    const auto        globals = dacglobals{get_self(), dac_id};
    name              owner   = dacdir::dac_for_id(dac_id).owner;

    // Find the mean pay using a temporary vector to hold the requestedpay amounts.
    extended_asset total = globals.get_requested_pay_max() - globals.get_requested_pay_max();
    int64_t        count = 0;
    for (auto cust : custodians) {
        if (total.get_extended_symbol().get_symbol() == cust.requestedpay.symbol) {
            if (cust.requestedpay.amount <= globals.get_requested_pay_max().quantity.amount) {
                total += extended_asset(cust.requestedpay, total.contract);
            }
            count += 1;
        }
    }

    print("count during mean pay: ", count, " total: ", total);

    asset meanAsset = count == 0 ? total.quantity : total.quantity / count;

    print("mean asset for pay: ", meanAsset);

    auto pendingPayReceiverSymbolIndex = pending_pay.get_index<"receiversym"_n>();

    if (meanAsset.amount > 0) {
        for (auto cust : custodians) {
            print("\nLooping through custodians : ", cust.cust_name);

            checksum256 idx = pay::getIndex(cust.cust_name, total.get_extended_symbol());
            print("\ncreated a joint index : ", idx);
            auto itrr = pendingPayReceiverSymbolIndex.find(idx);
            if (itrr != pendingPayReceiverSymbolIndex.end() && itrr->receiver == cust.cust_name &&
                itrr->quantity.get_extended_symbol() == total.get_extended_symbol()) {
                pendingPayReceiverSymbolIndex.modify(itrr, same_payer, [&](pay &p) {
                    print("\nAdding to existing amount with : ", extended_asset(meanAsset, total.contract));
                    p.quantity += extended_asset(meanAsset, total.contract);
                });
            } else {
                print("\n Creating pending pay amount with : ", extended_asset(meanAsset, total.contract));

                pending_pay.emplace(owner, [&](pay &p) {
                    p.key      = pending_pay.available_primary_key();
                    p.receiver = cust.cust_name;
                    p.quantity = extended_asset(meanAsset, total.contract);
                });
            }
        }
    }

    print("distribute mean pay");
}

void daccustodian::assertPeriodTime(const dacglobals &globals) {
    time_point_sec timestamp        = time_point_sec(eosio::current_time_point());
    uint32_t       periodBlockCount = (timestamp - globals.get_lastperiodtime().sec_since_epoch()).sec_since_epoch();
    check(periodBlockCount > globals.get_periodlength(),
        "ERR::NEWPERIOD_EARLY::New period is being called too soon. Period length is %s periodBlockCount: %s",
        globals.get_periodlength(), periodBlockCount);
}

void daccustodian::assertPendingPeriodTime(const dacglobals &globals) {
    time_point_sec now                  = time_point_sec(eosio::current_time_point());
    uint32_t pending_period_block_count = (now - globals.get_pending_period_time().sec_since_epoch()).sec_since_epoch();
    check(pending_period_block_count >= globals.get_pending_period_delay(),
        "ERR::NEWPERIOD_PENDING_EARLY::New period is being called too soon while in pending phase. Pending length is %s periodBlockCount: %s",
        globals.get_pending_period_delay(), pending_period_block_count);
}

bool daccustodian::periodIsPending(name dac_id) {
    pending_custodians_table pending_custs(get_self(), dac_id.value);
    return pending_custs.begin() != pending_custs.end();
}

void daccustodian::prepareCustodians(name dac_id) {
    // Configure custodians for the next period.
    pending_custodians_table pending_custs(get_self(), dac_id.value);

    candidates_table registered_candidates(get_self(), dac_id.value);
    const auto       globals      = dacglobals{get_self(), dac_id};
    name             auth_account = dacdir::dac_for_id(dac_id).owner;
    auto             byvotes      = registered_candidates.get_index<"bydecayed"_n>();

    const auto electcount = S{globals.get_numelected()};
    auto       cand_itr   = byvotes.begin();

    auto currentCustodianCount = S{uint8_t{0}};

    while (currentCustodianCount < electcount) {
        check(cand_itr != byvotes.end() && cand_itr->total_vote_power > 0,
            "ERR::NEWPERIOD_NOT_ENOUGH_CANDIDATES::There are not enough eligible candidates to run new period without causing potential lock out permission structures for this DAC.");

        // If the candidate is inactive or is already a pending custodian skip to the next one.
        if (!cand_itr->is_active) {
            cand_itr++;
        } else {
            pending_custs.emplace(auth_account, [&](custodian &c) {
                c.cust_name           = cand_itr->candidate_name;
                c.requestedpay        = cand_itr->requestedpay;
                c.total_vote_power    = cand_itr->total_vote_power;
                c.rank                = cand_itr->rank;
                c.number_voters       = cand_itr->number_voters;
                c.avg_vote_time_stamp = cand_itr->avg_vote_time_stamp;
            });

            currentCustodianCount++;
            cand_itr++;
        }
    }
}

void daccustodian::allocateCustodians(name dac_id) {
    pending_custodians_table pending_custs(get_self(), dac_id.value);
    custodians_table         custodians(get_self(), dac_id.value);

    if (pending_custs.begin() == pending_custs.end()) {
        return; // SHOULD NOT HAPPEN
    }

    // Configure custodians for the next period.

    // candidates_table registered_candidates(get_self(), dac_id.value);
    const auto globals      = dacglobals{get_self(), dac_id};
    name       auth_account = dacdir::dac_for_id(dac_id).owner;

    auto newCustodianCount = S{uint8_t{0}};

    // Find how many new custodians do not exist in the current custodians.
    for (auto pending_itr = pending_custs.begin(); pending_itr != pending_custs.end(); pending_itr++) {
        if (custodians.find(pending_itr->cust_name.value) == custodians.end()) {
            newCustodianCount++;
        }
    }

    // Empty the custodians table to get a full set of new custodians based on the current votes.
    auto cust_itr = custodians.begin();
    while (cust_itr != custodians.end()) {
        cust_itr = custodians.erase(cust_itr);
    }

    // Move pending custodians into custodians1
    auto pending_cust_itr = pending_custs.begin();
    while (pending_cust_itr != pending_custs.end()) {
        custodians.emplace(auth_account, [&](custodian &c) {
            c.cust_name           = pending_cust_itr->cust_name;
            c.requestedpay        = pending_cust_itr->requestedpay;
            c.total_vote_power    = pending_cust_itr->total_vote_power;
            c.rank                = pending_cust_itr->rank;
            c.number_voters       = pending_cust_itr->number_voters;
            c.avg_vote_time_stamp = pending_cust_itr->avg_vote_time_stamp;
        });
        pending_cust_itr = pending_custs.erase(pending_cust_itr);
    }

    if (newCustodianCount >= globals.get_auth_threshold_high()) {
        action(permission_level{DACDIRECTORY_CONTRACT, "govmanage"_n}, DACDIRECTORY_CONTRACT, "hdlegovchg"_n,
            std::make_tuple(dac_id))
            .send();
    }
}

vector<eosiosystem::permission_level_weight> daccustodian::get_perm_level_weights(
    const custodians_table &custodians, const name &dac_id) {
    auto accounts = vector<eosiosystem::permission_level_weight>{};

    for (const auto &cust : custodians) {
        accounts.push_back({
            .permission = getCandidatePermission(cust.cust_name, dac_id),
            .weight     = 1,
        });
    }
    return accounts;
}

void daccustodian::add_auth_to_account(const name &accountToChange, const uint8_t threshold, const name &permission,
    const name &parent, vector<eosiosystem::permission_level_weight> weights, const bool msig) {
    if (msig) {
        weights.push_back({
            .permission = permission_level{MSIG_CONTRACT, "active"_n},
            .weight     = threshold,
        });
        // weights must be sorted to prevent invalid authorization error
        std::sort(weights.begin(), weights.end());
    }

    if (weights.size() > 0) {
        const auto auth = eosiosystem::authority{.threshold = threshold, .keys = {}, .accounts = weights};
        action(permission_level{accountToChange, "owner"_n}, "eosio"_n, "updateauth"_n,
            std::make_tuple(accountToChange, permission, parent, auth))
            .send();
    }
}

void daccustodian::add_all_auths(const name            &accountToChange,
    const vector<eosiosystem::permission_level_weight> &weights, const name &dac_id, const bool msig) {
    const auto globals = dacglobals{get_self(), dac_id};

    add_auth_to_account(accountToChange, globals.get_auth_threshold_high(), HIGH_PERMISSION, "active"_n, weights, msig);

    add_auth_to_account(
        accountToChange, globals.get_auth_threshold_mid(), MEDIUM_PERMISSION, HIGH_PERMISSION, weights, msig);

    add_auth_to_account(
        accountToChange, globals.get_auth_threshold_low(), LOW_PERMISSION, MEDIUM_PERMISSION, weights, msig);

    add_auth_to_account(accountToChange, 1, ONE_PERMISSION, LOW_PERMISSION, weights, msig);
}

void daccustodian::setMsigAuths(name dac_id) {
    const auto custodians      = custodians_table{get_self(), dac_id.value};
    const auto dac             = dacdir::dac_for_id(dac_id);
    const auto msigowned_opt   = dac.account_for_type_maybe(dacdir::MSIGOWNED);
    const auto is_msig         = msigowned_opt.has_value();
    const auto accountToChange = msigowned_opt.value_or(dac.owner);

    auto weights = get_perm_level_weights(custodians, dac_id);
    add_all_auths(accountToChange, weights, dac_id, is_msig);
}

asset balance_for_type(const dacdir::dac &dac, const dacdir::account_type type) {
    const auto account = dac.account_for_type(type);
    return eosdac::get_balance_graceful(account, TLM_TOKEN_CONTRACT, TLM_SYM);
}

ACTION daccustodian::claimbudget(const name &dac_id) {
    const auto dac = dacdir::dac_for_id(dac_id);
    require_auth(dac.owner);
    auto globals = dacglobals{get_self(), dac_id};
    check(globals.get_lastclaimbudgettime() < globals.get_lastperiodtime(),
        "Claimbudget can only be called once per period");
    const auto treasury_account            = dac.account_for_type(dacdir::TREASURY);
    const auto prop_recipient_account      = dac.account_for_type(dacdir::PROP_FUNDS);
    const auto spendings_recipient_account = dac.account_for_type_maybe(dacdir::SPENDINGS);
    if (!spendings_recipient_account && !prop_recipient_account && !treasury_account) {
        return;
    }
    const auto treasury_balance_beginning = balance_for_type(dac, dacdir::TREASURY);
    auto       running_treasury_balance   = treasury_balance_beginning;

    const auto prop_budget_amount     = globals.maybe_get_prop_budget_amount();
    const auto spending_budget_amount = globals.maybe_get_spendings_budget_amount();

    const auto wp_memo        = "period proposal budget"s;
    const auto spendings_memo = "period spendings budget"s;

    const auto should_ramp_down_payments   = (prop_budget_amount.has_value() && spending_budget_amount.has_value());
    const auto prop_amount_to_transfer     = prop_budget_amount.value_or(asset{0, TLM_SYM});
    const auto spending_amount_to_transfer = spending_budget_amount.value_or(asset{0, TLM_SYM});

    // Check if there is enough in the treasury to cover the budget amounts
    if (should_ramp_down_payments &&
        (prop_amount_to_transfer + spending_amount_to_transfer < running_treasury_balance)) {
        action(permission_level{treasury_account, "xfer"_n}, TLM_TOKEN_CONTRACT, "transfer"_n,
            make_tuple(treasury_account, prop_recipient_account, prop_amount_to_transfer, wp_memo))
            .send();

        running_treasury_balance -= prop_amount_to_transfer;

        if (spendings_recipient_account) {
            action(permission_level{treasury_account, "xfer"_n}, TLM_TOKEN_CONTRACT, "transfer"_n,
                make_tuple(treasury_account, *spendings_recipient_account, spending_amount_to_transfer, spendings_memo))
                .send();

            running_treasury_balance -= spending_amount_to_transfer;
        }
    } else { // If there is not enough in the treasury to cover the budget amounts, distribute the treasury balance
             // based on the budget percentage

        const auto prop_budget_percentage = globals.maybe_get_prop_budget_percentage();

        if (!prop_budget_percentage.has_value()) {
            return;
        }
        const auto prop_amount_to_transfer = running_treasury_balance * *prop_budget_percentage / 10000;
        if (prop_amount_to_transfer.amount > 0) {
            action(permission_level{treasury_account, "xfer"_n}, TLM_TOKEN_CONTRACT, "transfer"_n,
                make_tuple(treasury_account, prop_recipient_account, prop_amount_to_transfer, wp_memo))
                .send();

            running_treasury_balance -= prop_amount_to_transfer;
        }

        const asset spendings_for_period = running_treasury_balance - asset{1, symbol{"TLM", 4}};

        // Ensure we don't attempt to transfer more than the treasury balance and
        // leave 0.0001 TLM in the treasury to avoid deleting the balance row.
        if (spendings_recipient_account && spendings_for_period.amount > 1) {
            check(spendings_for_period <= running_treasury_balance,
                "ERR::CLAIMBUDGET_SPENDINGS_AMOUNT_TOO_HIGH::Spendings amount is greater than the treasury balance. spendings_for_period: %s, Treasury balance: %s",
                spendings_for_period, running_treasury_balance);
            action(permission_level{treasury_account, "xfer"_n}, TLM_TOKEN_CONTRACT, "transfer"_n,
                make_tuple(treasury_account, *spendings_recipient_account, spendings_for_period, spendings_memo))
                .send();

            running_treasury_balance -= spendings_for_period;
        }
    }
    globals.set_lastclaimbudgettime(time_point_sec(current_time_point()));
}

#ifdef IS_DEV
ACTION daccustodian::fillstate(const name &dac_id) {
    auto globals = dacglobals{get_self(), dac_id};
}
#endif

#ifdef DEBUG

ACTION daccustodian::migratestate(const name &dac_id) {
    check(!dacglobals_singleton(get_self(), dac_id.value).exists(), "Already migrated dac %s", dac_id);
    auto new_state = dacglobals{get_self(), dac_id};
}
#endif

ACTION daccustodian::newperiod(const string &message, const name &dac_id) {
    /* This is a housekeeping method, it can be called by anyone by design */
    const auto dac                = dacdir::dac_for_id(dac_id);
    const auto activation_account = dac.account_for_type_maybe(dacdir::ACTIVATION);

    auto auths = std::vector<permission_level>{{dac.owner, "owner"_n}};

    if (activation_account) {
        require_auth(*activation_account);
        auths.emplace_back(*activation_account, "active"_n);
    }

    eosio::action(auths, get_self(), "runnewperiod"_n, make_tuple(message, dac_id)).send();
}

ACTION daccustodian::runnewperiod(const string &message, const name &dac_id) {
    /* This is a housekeeping method, it can be called by anyone by design */
    auto globals = dacglobals{get_self(), dac_id};

    dacdir::dac found_dac          = dacdir::dac_for_id(dac_id);
    const auto  activation_account = found_dac.account_for_type_maybe(dacdir::ACTIVATION);

    if (activation_account) {
        require_auth(*activation_account);

        print("\n\nSending notification to ", *activation_account, "::assertunlock");

        action(permission_level{*activation_account, "notify"_n}, *activation_account, "assertunlock"_n,
            std::make_tuple(dac_id))
            .send();
    } else {
        // Get the token supply of the lockup asset token (eg. EOSDAC)
        auto statsTable = stats(found_dac.symbol.get_contract(), found_dac.symbol.get_symbol().code().raw());
        auto tokenStats = statsTable.begin();
        check(tokenStats != statsTable.end(), "ERR::STATS_NOT_FOUND::Stats table not found");
        print("\n\nstats: ", tokenStats->supply, " contract: ", found_dac.symbol.get_contract(),
            " symbol: ", found_dac.symbol.get_symbol());

        uint64_t token_current_supply = tokenStats->supply.amount;

        auto         tokenStakeConfig = stake_config::get_current_configs(found_dac.symbol.get_contract(), dac_id);
        const double percent_of_current_voter_engagement =
            S{globals.get_total_weight_of_votes()}.to<double>() / S{token_current_supply}.to<double>() * S{100.0};

        check(token_current_supply > globals.get_token_supply_theshold(),
            "ERR::NEWPERIOD_TOKEN_SUPPLY_TOO_LOW::Token Supply %s is insufficient to execute newperiod (%s required).",
            token_current_supply, globals.get_token_supply_theshold());

        check(globals.get_met_initial_votes_threshold() == true ||
                  percent_of_current_voter_engagement > globals.get_initial_vote_quorum_percent(),
            "ERR::NEWPERIOD_VOTER_ENGAGEMENT_LOW_ACTIVATE::Voter engagement %s is insufficient to activate the DAC (%s required) token_current_supply: %s total_weight_of_votes: %s.",
            percent_of_current_voter_engagement, globals.get_initial_vote_quorum_percent(), token_current_supply,
            globals.get_total_weight_of_votes());

        check(percent_of_current_voter_engagement > globals.get_vote_quorum_percent(),
            "ERR::NEWPERIOD_VOTER_ENGAGEMENT_LOW_PROCESS::Voter engagement is insufficient to process a new period");
    }
    globals.set_met_initial_votes_threshold(true);

    if (!periodIsPending(dac_id)) {
        assertPeriodTime(globals);
        prepareCustodians(dac_id);
        globals.set_pending_period_time(current_block_time().to_time_point());
    } else {
        assertPendingPeriodTime(globals);

        // Distribute Pay is called before   is called to ensure custodians are paid for the just
        // passed period. This also implies custodians should not be paid the first time this is called. Distribute
        // pay to the current custodians.
        distributeMeanPay(dac_id);

        // Set custodians for the next period.
        allocateCustodians(dac_id);

        // Set the auths on the dacauthority account
        setMsigAuths(dac_id);

        globals.set_lastperiodtime(current_block_time().to_time_point());
    }
}
