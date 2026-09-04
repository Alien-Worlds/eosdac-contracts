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
         * This action is only callable by the proposals contract, which sends it as
         * escrow@approve. The named approver must still be the sender (when the escrow is not
         * disputed) or the arbiter (when it is), but the call itself arrives from the proposals
         * contract so that the escrow and the proposal it belongs to are always settled
         * together. Upon success the escrow funds will be sent to the receiver and the
         * arbiter's fees to the arbiter account, and the escrow record removed.
         *
         * @param key: the unique identifier for the escrow entry
         * @param approver: the EOSIO account name for the account approving this escrow.
         * @param dac_id The dac_id for the scope where the escrow is stored
         */
        ACTION approve(name key, name approver, name dac_id);
        /**
         * @brief Disapproves an escrow and returns funds to the sender
         *
         * This action is only callable by the proposals contract, which sends it as
         * escrow@approve while handling arbdeny. The named disapprover must still be the
         * assigned arbiter and the escrow must be disputed. Upon success the escrow funds will
         * be returned to the sender and the escrow record removed.
         *
         * @param key: the unique identifier for the escrow entry
         * @param disapprover: the EOSIO account name for the account disapproving this escrow.
         * @param dac_id The dac_id for the scope where the escrow is stored
         *
         * @pre Caller must be this contract, i.e. the proposals contract acting as escrow@approve
         * @pre The named disapprover must be the arbiter
         * @pre Escrow must be in disputed/locked state
         */
        ACTION disapprove(name key, name disapprover, name dac_id);
        /**
         * @brief Refunds the escrowed amount back to the sender
         *
         * This action is only callable by the proposals contract, which reaches it through
         * cancelwip when the proposer abandons their own work, or reclaimwip when the dac
         * recovers an escrow the worker has left behind. Those actions own the rules about who
         * may recover what and when, including the escrow expiry that used to be checked here.
         * The escrow must not be locked for arbitration. Upon success the escrowed funds are
         * returned to the sender and the escrow record removed.
         *
         * @param key Unique identifer for the escrow to refund
         * @param dac_id The dac_id for the scope where the escrow is stored
         */
        ACTION refund(name key, name dac_id);

        /**
         * @brief Initiates a dispute for an escrow
         *
         * This action locks an escrow that has not been paid but the receiver feels should be.
         * It is only callable by the proposals contract, which sends it while moving the
         * proposal into its disputed state, so that the escrow lock and the proposal state
         * always agree. The escrow must have been funded before it can be disputed. Upon
         * success the escrow record is locked and can then only be resolved by the nominated
         * arbiter.
         *
         * @param key Unique identifer for the escrow to dispute
         * @param dac_id The dac_id for the scope where the escrow is stored
         *
         * @pre Caller must be this contract, i.e. the proposals contract acting as escrow@approve
         * @pre Escrow must have been funded (receiver_pay > 0)
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
        /// Pays the arbiter their fee, for escrows they have ruled on.
        void pay_arbiter(const escrows_table::const_iterator esc_itr);
        /// Returns an unearned arbiter fee to the sender, for escrows that end without a ruling.
        void refund_arbiter_pay(const escrows_table::const_iterator esc_itr);
    };
} // namespace eosdac
