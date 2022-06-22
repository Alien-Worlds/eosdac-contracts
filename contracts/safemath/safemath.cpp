#include "../../contract-shared-headers/safemath.hpp"
#include "../../contract-shared-headers/common_utilities.hpp"
#include <eosio/eosio.hpp>

using namespace eosio;

CONTRACT safemath : public contract {
  public:
    using contract::contract;

    ACTION testuint() {
        const uint64_t a = 123;
        const uint64_t b = 456;
        const uint64_t c = 789;
        const uint64_t d = 2718;
        const uint64_t e = 31;

        check(S{a} * S{b} * S{c} == a * b * c, "wrong result 1");
        check(S{a} * S{b} / S{c} == a * b / c, "wrong result 2");
        check(S{a} / S{b} == a / b, "wrong result 3");
        check(S{a} + S{b} == a + b, "wrong result 4");
        check(S{a} + S{b} * S{c} == a + b * c, "wrong result 5");

        const auto x1  = S{a} * S{b} / S{c} + S{d} - S{e};
        const auto x1_ = a * b / c + d - e;
        check(x1 == x1_, "wrong result 6");
        check(std::is_same_v<decltype(x1), decltype(x1_)>, fmt("wrong type 1 %s", x1));
        check(std::is_same_v<decltype(S{a}), S<uint64_t>>, fmt("wrong type 2"));

        const auto x2  = S{a} - S{a};
        const auto x2_ = a - a;
        check(x2 == x2_, "wrong result 7");

        check(S{a} == a, "wrong result 8");
    }
    ACTION testint() {
        const int64_t a = 123;
        const int64_t b = 456;
        const int64_t c = 789;
        const int64_t d = 2718;
        const int64_t e = 31;

        check(S{a} * S{b} * S{c} == a * b * c, "wrong result 1");
        check(S{a} * S{b} / S{c} == a * b / c, "wrong result 2");
        check(S{a} / S{b} == a / b, "wrong result 3");
        check(S{a} + S{b} == a + b, "wrong result 4");
        check(S{a} + S{b} * S{c} == a + b * c, "wrong result 5");

        const auto x1  = S{a} * S{b} / S{c} + S{d} - S{e};
        const auto x1_ = a * b / c + d - e;
        check(x1 == x1_, "wrong result 6");
        check(std::is_same_v<decltype(x1), decltype(x1_)>, fmt("wrong type 1 %s", x1));
        check(std::is_same_v<decltype(S{a}), S<int64_t>>, fmt("wrong type 2"));

        const auto x2  = S{a} - S{a};
        const auto x2_ = a - a;
        check(x2 == x2_, "wrong result 7");

        check(S{a} == a, "wrong result 8");
    }

    ACTION testfloat() {
        const double a = 123.1432;
        const double b = 456.5534;
        const double c = 789.35436;
        const double d = 2718.26536;
        const double e = 31.863302;

        check(S{a} * S{b} * S{c} == a * b * c, "wrong result 1");
        check(S{a} * S{b} / S{c} == a * b / c, "wrong result 2");
        check(S{a} / S{b} == a / b, "wrong result 3");
        check(S{a} + S{b} == a + b, "wrong result 4");
        check(S{a} + S{b} * S{c} == a + b * c, "wrong result 5");

        const auto x1  = S{a} * S{b} / S{c} + S{d} - S{e};
        const auto x1_ = a * b / c + d - e;
        check(x1 == x1_, "wrong result 6");
        check(std::is_same_v<decltype(x1), decltype(x1_)>, fmt("wrong type 1 %s", x1));
        check(std::is_same_v<decltype(S{a}), S<double>>, fmt("wrong type 2"));

        const auto x2  = S{a} - S{a};
        const auto x2_ = a - a;
        check(x2 == x2_, "wrong result 7");

        check(S{a} == a, "wrong result 8");
    }

    ACTION smoverflow() {
        S{std::numeric_limits<int64_t>::max()} * S<int64_t>{2};
    }

    ACTION umoverflow() {
        S{std::numeric_limits<uint64_t>::max()} * S<uint64_t>{2};
    }

    ACTION aoverflow() {
        S{std::numeric_limits<int64_t>::max()} + S<int64_t>{1};
    }

    ACTION auoverflow() {
        S{std::numeric_limits<uint64_t>::max()} + S<uint64_t>{1};
    }

    ACTION uunderflow() {
        S<uint64_t>{1} - S<uint64_t>{2};
    }

    ACTION usdivzero() {
        S<uint64_t>{1} / S<uint64_t>{0};
    }
    ACTION sdivzero() {
        S<int64_t>{1} / S<int64_t>{0};
    }

    ACTION fdivzero() {
        S{1.0} / S{0.0};
    }

    ACTION sdivoverflow() {
        const auto min_value = std::numeric_limits<int64_t>::min();
        const auto res       = S{min_value} / S<int64_t>{-1};
        check(false, fmt("res: %s max: %s", res, min_value));
    }
    ACTION infinity() {
        S<float>{1.0} + S{INFINITY};
    }
    ACTION nan() {
        S<float>{1.0} + S{NAN};
    }
};