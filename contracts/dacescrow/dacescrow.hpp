#include "../../contract-shared-headers/contracts-common/string_format.hpp"
#include "dacescrow_shared.hpp"
#include <eosio/asset.hpp>
#include <eosio/eosio.hpp>
#include <eosio/time.hpp>
#include <optional>

using namespace eosio;
using namespace std;

namespace eosdac {
    class dacescrow : public contract {

      private:
        name sending_code;

      public:
        dacescrow(name s, name code, datastream<const char *> ds) : contract(s, code, ds) {
            sending_code = name{code};
        }

        ~dacescrow();

        /**
         * Escrow contract
         */

        /**
         * @brief Initializes a new escrow agreement between parties
         *
         * This action creates a new escrow entry with the specified sender, receiver,
         * and arbiter. The escrow starts unfunded and must receive transfers to become
         * active. Once expired, unfunded escrows can be cancelled by the sender.
         *
         * @param sender The account that will fund the escrow
         * @param receiver The account that will receive funds upon approval
         * @param arb The arbiter who can resolve disputes
         * @param expires The expiration time for the escrow
         * @param memo Description or memo for the escrow transaction
         * @param ext_reference External reference identifier (must be unique)
         * @param dac_id The DAC scope identifier
         *
         * @pre Caller must be the sender account
         * @pre Receiver cannot be the same as arbiter
         * @pre Sender cannot be the same as arbiter
         * @pre Expiry date must be in the future
         * @pre External reference must be unique within the DAC scope
         */
        ACTION init(
            name sender, name receiver, name arb, time_point_sec expires, string memo, name ext_reference, name dac_id);
        using init_action = action_wrapper<"init"_n, &dacescrow::init>;

        /**
         * @brief Handles incoming token transfers to fund escrows
         *
         * This notification handler processes incoming transfers and deposits them
         * into the corresponding escrow accounts. The memo must follow the format
         * "type:reference:dac_id" where type is either "rec" (receiver payment) or
         * "arb" (arbiter payment).
         *
         * @param from The account sending the tokens
         * @param to The receiving account (should be this contract)
         * @param quantity The amount and token type being transferred
         * @param memo The transfer memo in format "type:reference:dac_id"
         *
         * @pre Transfer must be sent to this contract
         * @pre Memo must have exactly 3 parts separated by colons
         * @pre Payment type must be either "rec" or "arb"
         * @pre Corresponding escrow must exist
         * @pre Escrow must not already have payment of the specified type
         */
        [[eosio::on_notify("*::transfer")]] void transfer(name from, name to, asset quantity, string memo);
        /**
         * @brief Approves an escrow and releases funds to the receiver
         *
         * This action can be called by the sender (when escrow is not disputed), the arbiter
         * (when escrow is disputed/locked), or the contract itself for inter-contract calls.
         * Upon success, the escrow funds will be sent to the receiver and the arbiter's
         * fees will be sent to the arbiter account. The escrow record will be removed from the contract table.
         *
         * @param key: the unique identifier for the escrow entry
         * @param approver: the EOSIO account name for the account approving this escrow.
         * @param dac_id The dac_id for the scope where the escrow is stored
         */
        ACTION approve(name key, name approver, name dac_id);
        /**
         * @brief Disapproves an escrow and returns funds to the sender
         *
         * This action can be called by the assigned arbiter for the escrow (when escrow is disputed)
         * or by the contract itself for inter-contract calls. Upon success, the escrow funds will be
         * returned to the sender of the escrow funds and the escrow record will be removed from the
         * contract table.
         *
         * @param key: the unique identifier for the escrow entry
         * @param disapprover: the EOSIO account name for the account disapproving this escrow.
         * @param dac_id The dac_id for the scope where the escrow is stored
         *
         * @pre Only the arbiter can disapprove when called by external accounts
         * @pre Escrow must be in disputed/locked state when called by arbiter
         */
        ACTION disapprove(name key, name disapprover, name dac_id);
        /**
         * @brief Refunds the escrowed amount back to the sender
         *
         * This action can be called by the receiver (at any time), the sender (after expiry),
         * or the contract itself for inter-contract calls. The escrow must not be locked for
         * arbitration. Upon success, the escrowed funds will be transferred back to the sender's
         * account and the escrow record will be removed from the contract.
         *
         * @param key Unique identifer for the escrow to refund
         * @param dac_id The dac_id for the scope where the escrow is stored
         */
        ACTION refund(name key, name dac_id);

        /**
         * @brief Initiates a dispute for an escrow
         *
         * This action is intended to dispute an escrow that has not been paid but the receiver feels should be
         * paid. It can be called by the intended receiver of the escrow or by the contract itself for inter-contract
         * calls. The escrow must have been funded before it can be disputed. Upon success the escrow record will be
         * locked and then it can only be resolved by the nominated arbiter for the escrow.
         *
         * @param key Unique identifer for the escrow to dispute
         * @param dac_id The dac_id for the scope where the escrow is stored
         *
         * @pre Escrow must have been funded (receiver_pay > 0)
         * @pre When called by external accounts, only the receiver can dispute
         */
        ACTION dispute(name key, name dac_id);
        /**
         * @brief This action is intended to cancel an escrow. It can only be called by the sender of the escrow before
         * funds have been transferred into the identified escrow. Upon success the escrow record will be deleted the
         * escrow contract table.
         *
         * @param key Unique identifer for the escrow to refund
         * @param dac_id The dac_id for the scope where the escrow is stored
         */
        ACTION cancel(name key, name dac_id);

      private:
        void pay_arbiter(const escrows_table::const_iterator esc_itr);
    };
} // namespace eosdac
