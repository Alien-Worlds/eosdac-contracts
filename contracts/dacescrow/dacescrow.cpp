#include "../../contract-shared-headers/contracts-common/util.hpp"
#include <eosio/eosio.hpp>
#include <eosio/transaction.hpp>

#include <string>

#include "dacescrow.hpp"

using namespace eosio;
using namespace std;

namespace eosdac {

    dacescrow::~dacescrow() {}

    ACTION dacescrow::transfer(name from, name to, asset quantity, string memo) {

        if (to != get_self() || from == get_self()) {
            return;
        }

        require_auth(from);
        auto tokens = split(memo, ":");
        check(tokens.size() == 3, "Invalid memo format");
        string paymentType = tokens[0];
        auto   keyName     = name(tokens[1].c_str());
        auto   dac_id      = name(tokens[2].c_str());

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(keyName.value);

        check(esc_itr != escrows.end(), "Could not find existing escrow to deposit to, transfer cancelled");

        escrows.modify(esc_itr, from, [&](escrow_info &e) {
            if (paymentType == "rec") {
                check(esc_itr->receiver_pay.quantity.amount == 0,
                    "ERR::TRANSFER_RECEIVER::This escrow has already paid been into for the recevier.");
                e.receiver_pay = extended_asset{quantity, sending_code};
            } else if (paymentType == "arb") {
                check(esc_itr->arbiter_pay.quantity.amount == 0,
                    "ERR::TRANSFER_ARB::This escrow has already paid been into for the arbiter.");
                e.arbiter_pay = extended_asset{quantity, sending_code};
            } else {
                check(false, "dacescrow::init invalid payment type %s", paymentType);
            }
        });
    }

    ACTION
    dacescrow::init(
        name sender, name receiver, name arb, time_point_sec expires, string memo, name ext_reference, name dac_id) {
        require_auth(sender);

        check(receiver != arb, "Receiver cannot be the same as arbiter");
        check(sender != arb, "Sender cannot be the same as arbiter");
        check(expires > time_point_sec(eosio::current_time_point()), "Expiry date is in the past");

        extended_asset zero_asset{{0, symbol{"EOS", 4}}, "eosio.token"_n};

        auto escrows   = escrows_table(get_self(), dac_id.value);
        auto by_sender = escrows.get_index<"bysender"_n>();
        check(
            escrows.find(ext_reference.value) == escrows.end(), "Already have an escrow with this external reference");

        escrows.emplace(sender, [&](escrow_info &p) {
            p.key          = ext_reference;
            p.sender       = sender;
            p.receiver     = receiver;
            p.arb          = arb;
            p.receiver_pay = zero_asset;
            p.arbiter_pay  = zero_asset;
            p.expires      = expires;
            p.memo         = memo;
            p.disputed     = false;
        });
    }

    ACTION dacescrow::approve(name key, name approver, name dac_id) {
        if (!has_auth(get_self())) {
            require_auth(approver);
        }

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(key.value);
        check(esc_itr != escrows.end(), "Could not find escrow with that index");

        check(esc_itr->receiver_pay.quantity.amount > 0, "This has not been initialized with a transfer");

        if (esc_itr->arb == approver) {
            check(esc_itr->disputed,
                "ERR::ESCROW_IS_NOT_LOCKED::This escrow is not locked. It can only be approved/disapproved by the arbiter while it is locked.");
        } else if (esc_itr->sender == approver) {
            check(!esc_itr->disputed,
                "ERR::ESCROW_DISPUTED::This escrow is locked and can only be approved/disapproved by the arbiter.");
        } else {
            check(false, "ERR::ESCROW_NOT_ALLOWED_TO_APPROVE::Only the arbiter or sender can approve an escrow.");
        }
        pay_arbiter(esc_itr);

        // send funds to the receiver
        eosio::action(eosio::permission_level{_self, "active"_n}, esc_itr->receiver_pay.contract, "transfer"_n,
            make_tuple(_self, esc_itr->receiver, esc_itr->receiver_pay.quantity, esc_itr->memo))
            .send();
        escrows.erase(esc_itr);
    }

    ACTION dacescrow::disapprove(name key, name disapprover, name dac_id) {
        if (!has_auth(get_self())) {
            require_auth(disapprover);
        }

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(key.value);
        check(esc_itr != escrows.end(), "Could not find escrow with that index");

        check(esc_itr->receiver_pay.quantity.amount > 0, "This has not been initialized with a transfer");

        check(disapprover == esc_itr->arb, "Only arbiter can disapprove");
        check(esc_itr->disputed,
            "ERR::ESCROW_IS_NOT_LOCKED::This escrow is not locked. It can only be approved/disapproved by the arbiter while it is locked.");

        eosio::action(eosio::permission_level{_self, "active"_n}, esc_itr->receiver_pay.contract, "transfer"_n,
            make_tuple(_self, esc_itr->sender, esc_itr->receiver_pay.quantity, esc_itr->memo))
            .send();

        pay_arbiter(esc_itr);
        escrows.erase(esc_itr);
    }

    /*
     * Empties an unfilled escrow request
     */
    ACTION dacescrow::cancel(name key, name dac_id) {

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(key.value);
        check(esc_itr != escrows.end(), "Could not find escrow with that index");

        require_auth(esc_itr->sender);

        check(0 == esc_itr->receiver_pay.quantity.amount, "Amount is not zero, this escrow is locked down");

        escrows.erase(esc_itr);
    }

    /*
     * Allows the receiver to refund early to the sender or the sender to withdraw the funds if the escrow has expired
     */
    ACTION dacescrow::refund(name key, name dac_id) {

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(key.value);
        check(esc_itr != escrows.end(), "Could not find escrow with that index");

        if (!has_auth(esc_itr->receiver) && !has_auth(get_self())) {
            require_auth(esc_itr->sender);

            time_point_sec time_now = time_point_sec(eosio::current_time_point());
            check(time_now >= esc_itr->expires, "Escrow has not expired");
        }

        check(esc_itr->receiver_pay.quantity.amount > 0, "This has not been initialized with a transfer");
        check(!esc_itr->disputed,
            "ERR::ESCROW_DISPUTED::This escrow is locked and can only be approved/disapproved by the arbiter.");

        eosio::action(eosio::permission_level{_self, "active"_n}, esc_itr->receiver_pay.contract, "transfer"_n,
            make_tuple(_self, esc_itr->sender, esc_itr->receiver_pay.quantity, esc_itr->memo))
            .send();

        escrows.erase(esc_itr);
    }

    ACTION dacescrow::dispute(name key, name dac_id) {

        auto escrows = escrows_table(get_self(), dac_id.value);
        auto esc_itr = escrows.find(key.value);
        check(esc_itr != escrows.end(), "Could not find escrow with that index");

        if (!has_auth(get_self())) {
            require_auth(esc_itr->receiver);
        }

        check(esc_itr->receiver_pay.quantity.amount > 0, "This has not been initialized with a transfer");

        escrows.modify(esc_itr, same_payer, [&](escrow_info &e) {
            e.disputed = true;
        });
    }

    void dacescrow::pay_arbiter(const escrows_table::const_iterator esc_itr) {
        if (esc_itr->arbiter_pay.quantity.amount > 0) {
            eosio::action(eosio::permission_level{_self, "active"_n}, esc_itr->arbiter_pay.contract, "transfer"_n,
                make_tuple(_self, esc_itr->arb, esc_itr->arbiter_pay.quantity, esc_itr->memo))
                .send();
        }
    }

} // namespace eosdac
