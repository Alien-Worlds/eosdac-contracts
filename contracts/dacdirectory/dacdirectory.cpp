#include "dacdirectory.hpp"

using namespace eosio;
using namespace std;

namespace eosdac {
    namespace dacdir {

        dacdirectory::dacdirectory(eosio::name self, eosio::name first_receiver, eosio::datastream<const char *> ds)
            : contract(self, first_receiver, ds), _dacs(get_self(), get_self().value) {}

        void dacdirectory::regdac(eosio::name owner, eosio::name dac_id, extended_symbol dac_symbol, string title,
            map<uint8_t, string> refs, map<uint8_t, eosio::name> accounts) {
            require_auth(owner);

            const vector<name> forbidden{
                "admin"_n, "builder"_n, "members"_n, "dacauthority"_n, "daccustodian"_n, "eosdactokens"_n};
            check(std::find(forbidden.begin(), forbidden.end(), dac_id) == forbidden.end(),
                "ERR::DAC_FORBIDDEN_NAME::DAC ID is forbidden");
            auto existing = _dacs.find(dac_id.value);

            auto symbol_idx          = _dacs.get_index<"bysymbol"_n>();
            auto matching_symbol_itr = symbol_idx.find(eosdac::raw_from_extended_symbol(dac_symbol));
            if (existing == _dacs.end()) {
                eosio::check(matching_symbol_itr == symbol_idx.end() ||
                                 matching_symbol_itr->symbol.get_symbol().code() != dac_symbol.get_symbol().code(),
                    "ERR::DAC_EXISTS_SYMBOL::A dac already exists for the provided symbol.");
            }

            if (existing == _dacs.end()) {
                // dac name must be >= 5 characters, with no dots
                // skip the extra 4 bytes
                uint64_t tmp     = dac_id.value >> 4;
                bool     started = false;
                uint8_t  length  = 0;
                for (uint8_t i = 0; i < 12; i++) {
                    if (!(tmp & 0x1f)) {
                        // blank (dot)
                        check(!started, "ERR::DAC_ID_DOTS::DAC ID cannot contain dots");
                    } else {
                        started = true;
                        length++;
                    }

                    tmp >>= 5;
                }
                check(length > 4, "ERR::DAC_ID_SHORT::DAC ID must be at least 5 characters");

                if (accounts.find(AUTH) != accounts.end()) {
                    require_auth(accounts.at(AUTH));
                }
                if (accounts.find(TREASURY) != accounts.end()) {
                    require_auth(accounts.at(TREASURY));
                }
                for (const auto &[key, account] : accounts) {
                    check(is_account(account), "ERR::ACCOUNT_DOES_NOT_EXIST: Account '%s' does not exist", account);
                }
                _dacs.emplace(owner, [&](dac &d) {
                    d.owner    = owner;
                    d.dac_id   = dac_id;
                    d.symbol   = dac_symbol;
                    d.title    = title;
                    d.refs     = refs;
                    d.accounts = accounts;
                });
            } else {
                require_auth(existing->owner);

                _dacs.modify(existing, same_payer, [&](dac &d) {
                    d.title = title;
                    d.refs  = refs;
                });
            }
        }

        void dacdirectory::unregdac(name dac_id) {

            auto dac = _dacs.find(dac_id.value);
            check(dac != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(dac->owner);

            _dacs.erase(dac);
        }

        void dacdirectory::regaccount(name dac_id, name account, uint8_t type) {

            check(is_account(account), "ERR::INVALID_ACCOUNT::Invalid or non-existent account supplied");

            auto dac_inst = _dacs.find(dac_id.value);
            check(dac_inst != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(dac_inst->owner);

            if (type == AUTH) {
                require_auth(account);
            } else if (type == TREASURY) {
                require_auth(account);
            }

            _dacs.modify(dac_inst, same_payer, [&](dac &d) {
                d.accounts[type] = account;
            });
        }

        void dacdirectory::unregaccount(name dac_id, uint8_t type) {

            auto dac_inst = _dacs.find(dac_id.value);
            check(dac_inst != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(dac_inst->owner);

            _dacs.modify(dac_inst, same_payer, [&](dac &a) {
                a.accounts.erase(type);
            });
        }

        void dacdirectory::regref(name dac_id, string value, uint8_t type) {

            auto dac_inst = _dacs.find(dac_id.value);
            check(dac_inst != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(dac_inst->owner);

            _dacs.modify(dac_inst, same_payer, [&](dac &d) {
                d.refs[type] = value;
            });
        }

        void dacdirectory::unregref(name dac_id, uint8_t type) {

            auto dac_inst = _dacs.find(dac_id.value);
            check(dac_inst != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(dac_inst->owner);

            _dacs.modify(dac_inst, same_payer, [&](dac &d) {
                d.refs.erase(type);
            });
        }

        void dacdirectory::setowner(name dac_id, name new_owner) {

            auto existing_dac = _dacs.find(dac_id.value);
            check(existing_dac != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(existing_dac->owner);
            require_auth(new_owner);

            _dacs.modify(existing_dac, new_owner, [&](dac &d) {
                d.owner = new_owner;
            });
        }

        void dacdirectory::settitle(name dac_id, string title) {
            auto existing_dac = _dacs.find(dac_id.value);
            check(existing_dac != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(existing_dac->owner);

            _dacs.modify(existing_dac, same_payer, [&](dac &d) {
                d.title = title;
            });
        }

        void dacdirectory::setstatus(name dac_id, uint8_t value) {
            auto dac_inst = _dacs.find(dac_id.value);
            check(dac_inst != _dacs.end(), "ERR::DAC_NOT_FOUND::DAC not found in directory");

            require_auth(get_self());

            _dacs.modify(dac_inst, same_payer, [&](dac &d) {
                d.dac_state = value;
            });
        }

    } // namespace dacdir
} // namespace eosdac
