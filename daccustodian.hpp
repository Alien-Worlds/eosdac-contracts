#include <eosiolib/eosio.hpp>
#include <eosiolib/multi_index.hpp>
#include <eosiolib/eosio.hpp>

using namespace eosio;
using namespace std;


// @abi table members
struct member {
    name sender;
    /// Hash of agreed terms
    string agreedterms;

    name primary_key() const { return sender; }

    EOSLIB_SERIALIZE(member, (sender)(agreedterms))
};

struct memberraw {
  name sender;
  asset quantity;

  EOSLIB_SERIALIZE(memberraw, (sender)(quantity))
};

typedef multi_index<N(members), member> regmembers;
