#include "../../contract-shared-headers/dacdirectory_shared.hpp"
using namespace eosdac;

ACTION daccustodian::updateconfige(const contr_config &new_config, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    check(new_config.numelected <= 67,
        "ERR::UPDATECONFIG_INVALID_NUM_ELECTED::The number of elected custodians must be <= 67");
    check(new_config.maxvotes <= new_config.numelected,
        "ERR::UPDATECONFIG_INVALID_MAX_VOTES::The number of max votes must be less than the number of elected candidates.");

    // No technical reason for this other than keeping some sanity in the settings
    check(new_config.periodlength <= 3 * 365 * 24 * 60 * 60,
        "ERR::UPDATECONFIG_PERIOD_LENGTH::The period length cannot be longer than 3 years.");

    check(new_config.pending_period_delay <= new_config.periodlength,
        "ERR::UPDATECONFIG_PENDING_PERIOD_LENGTH::The pending period length cannot be longer than the period length.");

    check(new_config.initial_vote_quorum_percent < 100,
        "ERR::UPDATECONFIG_INVALID_INITIAL_VOTE_QUORUM_PERCENT::The initial vote quorum percent must be less than 100 and most likely a lot less than 100 to be achievable for the DAC.");

    check(new_config.token_supply_theshold > 1000 * 10000,
        "ERR::UPDATECONFIG_INVALID_INITIAL_TOKEN_THRESHOLD::token_supply_theshold amount must be at least 1000 tokens (1000 * 10000).");

    check(new_config.vote_quorum_percent < 100,
        "ERR::UPDATECONFIG_INVALID_VOTE_QUORUM_PERCENT::The vote quorum percent must be less than 100 and most likely a lot less than 100 to be achievable for the DAC.");

    check(new_config.auth_threshold_high < new_config.numelected,
        "ERR::UPDATECONFIG_INVALID_AUTH_HIGH_TO_NUM_ELECTED::The auth threshold can never be satisfied with a value greater than the number of elected custodians");
    check(new_config.auth_threshold_mid <= new_config.auth_threshold_high,
        "ERR::UPDATECONFIG_INVALID_AUTH_HIGH_TO_MID_AUTH::The mid auth threshold cannot be greater than the high auth threshold.");
    check(new_config.auth_threshold_low <= new_config.auth_threshold_mid,
        "ERR::UPDATECONFIG_INVALID_AUTH_MID_TO_LOW_AUTH::The low auth threshold cannot be greater than the mid auth threshold.");

    if (new_config.should_pay_via_service_provider) {
        check(dacForScope.account_for_type_maybe(dacdir::SERVICE).has_value(),
            "ERR::UPDATECONFIG_NO_SERVICE_ACCOUNT should_pay_via_service_provider is true, but no SERVICE account is set.");
    }

    check(new_config.lockupasset.quantity.symbol == dacForScope.symbol.get_symbol(),
        "Symbol mismatch dac symbol is %s but symbol given is %s", dacForScope.symbol.get_symbol(),
        new_config.lockupasset.quantity.symbol);

    auto globals = dacglobals{get_self(), dac_id};

    globals.set_lockupasset(new_config.lockupasset);
    globals.set_maxvotes(new_config.maxvotes);
    globals.set_numelected(new_config.numelected);
    globals.set_periodlength(new_config.periodlength);
    globals.set_pending_period_delay(new_config.pending_period_delay);
    globals.set_should_pay_via_service_provider(new_config.should_pay_via_service_provider);
    globals.set_initial_vote_quorum_percent(new_config.initial_vote_quorum_percent);
    globals.set_vote_quorum_percent(new_config.vote_quorum_percent);
    globals.set_auth_threshold_high(new_config.auth_threshold_high);
    globals.set_auth_threshold_mid(new_config.auth_threshold_mid);
    globals.set_auth_threshold_low(new_config.auth_threshold_low);
    globals.set_lockup_release_time_delay(new_config.lockup_release_time_delay);
    globals.set_requested_pay_max(new_config.requested_pay_max);
    globals.set_token_supply_theshold(new_config.token_supply_theshold);
}

ACTION daccustodian::setlockasset(const extended_asset &lockupasset, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    check(lockupasset.quantity.symbol == dacForScope.symbol.get_symbol(),
        "Symbol mismatch dac symbol is %s but symbol given is %s", dacForScope.symbol.get_symbol(),
        lockupasset.quantity.symbol);

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_lockupasset(lockupasset);
}

ACTION daccustodian::setmaxvotes(const uint8_t &maxvotes, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(maxvotes <= globals.get_numelected(),
        "ERR::UPDATECONFIG_INVALID_MAX_VOTES::The number of max votes must be less than the number of elected candidates.");

    globals.set_maxvotes(maxvotes);
}

ACTION daccustodian::setnumelect(const uint8_t &numelected, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(numelected <= 67, "ERR::UPDATECONFIG_INVALID_NUM_ELECTED::The number of elected custodians must be <= 67");
    check(globals.get_maxvotes() <= numelected,
        "ERR::UPDATECONFIG_INVALID_MAX_VOTES::The number of max votes must be less than the number of elected candidates.");
    globals.set_numelected(numelected);
}

ACTION daccustodian::setperiodlen(const uint32_t &periodlength, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    // No technical reason for this other than keeping some sanity in the settings
    check(periodlength <= 3 * 365 * 24 * 60 * 60,
        "ERR::UPDATECONFIG_PERIOD_LENGTH::The period length cannot be longer than 3 years.");
    check(periodlength > 0, "ERR::UPDATECONFIG_PERIOD_LENGTH::The period length must be greater than 0.");
    check(globals.get_pending_period_delay() <= periodlength,
        "ERR::UPDATECONFIG_PENDING_PERIOD_LENGTH::The pending period length cannot be longer than the period length.");

    globals.set_periodlength(periodlength);
}

ACTION daccustodian::setpenddelay(const uint32_t &pending_period_delay, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(pending_period_delay <= globals.get_periodlength(),
        "ERR::UPDATECONFIG_PENDING_PERIOD_LENGTH::The pending period length cannot be longer than the period length.");

    globals.set_pending_period_delay(pending_period_delay);
}

ACTION daccustodian::setpayvia(const bool &should_pay_via_service_provider, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    if (should_pay_via_service_provider) {
        check(dacForScope.account_for_type_maybe(dacdir::SERVICE).has_value(),
            "ERR::UPDATECONFIG_NO_SERVICE_ACCOUNT should_pay_via_service_provider is true, but no SERVICE account is set.");
    }

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_should_pay_via_service_provider(should_pay_via_service_provider);
}

ACTION daccustodian::setinitvote(const uint32_t &initial_vote_quorum_percent, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    check(initial_vote_quorum_percent < 100,
        "ERR::UPDATECONFIG_INVALID_INITIAL_VOTE_QUORUM_PERCENT::The initial vote quorum percent must be less than 100 and most likely a lot less than 100 to be achievable for the DAC.");

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_initial_vote_quorum_percent(initial_vote_quorum_percent);
}

ACTION daccustodian::setvotequor(const uint32_t &vote_quorum_percent, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    check(vote_quorum_percent < 100,
        "ERR::UPDATECONFIG_INVALID_VOTE_QUORUM_PERCENT::The vote quorum percent must be less than 100 and most likely a lot less than 100 to be achievable for the DAC.");

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_vote_quorum_percent(vote_quorum_percent);
}

ACTION daccustodian::setauthhigh(const uint8_t &auth_threshold_high, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(auth_threshold_high < globals.get_numelected(),
        "ERR::UPDATECONFIG_INVALID_AUTH_HIGH_TO_NUM_ELECTED::The auth threshold can never be satisfied with a value greater than the number of elected custodians");

    globals.set_auth_threshold_high(auth_threshold_high);
}

ACTION daccustodian::setauthmid(const uint8_t &auth_threshold_mid, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(auth_threshold_mid <= globals.get_auth_threshold_high(),
        "ERR::UPDATECONFIG_INVALID_AUTH_HIGH_TO_MID_AUTH::The mid auth threshold cannot be greater than the high auth threshold.");

    globals.set_auth_threshold_mid(auth_threshold_mid);
}

ACTION daccustodian::setauthlow(const uint8_t &auth_threshold_low, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};

    check(auth_threshold_low <= globals.get_auth_threshold_mid(),
        "ERR::UPDATECONFIG_INVALID_AUTH_MID_TO_LOW_AUTH::The low auth threshold cannot be greater than the mid auth threshold.");

    globals.set_auth_threshold_low(auth_threshold_low);
}

ACTION daccustodian::setlockdelay(const uint32_t &lockup_release_time_delay, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_lockup_release_time_delay(lockup_release_time_delay);
}

ACTION daccustodian::setpaymax(const extended_asset &requested_pay_max, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_requested_pay_max(requested_pay_max);
}

ACTION daccustodian::settokensup(const uint64_t &token_supply_theshold, const name &dac_id) {

    dacdir::dac dacForScope = dacdir::dac_for_id(dac_id);
#ifdef IS_DEV
    // This will be enabled later in prod instead of get_self() to allow DAO's to control this config.
    require_auth(dacForScope.owner);
#else
    require_auth(get_self());
#endif

    check(token_supply_theshold > 1000 * 10000,
        "ERR::UPDATECONFIG_INVALID_INITIAL_TOKEN_THRESHOLD::token_supply_theshold amount must be at least 1000 tokens (1000 * 10000).");

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_token_supply_theshold(token_supply_theshold);
}

ACTION daccustodian::setbudget(const name &dac_id, const uint16_t percentage) {
    require_auth(get_self());

    auto globals = dacglobals{get_self(), dac_id};
    globals.set_budget_percentage(percentage);
}

ACTION daccustodian::unsetbudget(const name &dac_id) {
    require_auth(get_self());

    auto globals = dacglobals{get_self(), dac_id};
    globals.unset_budget_percentage();
}