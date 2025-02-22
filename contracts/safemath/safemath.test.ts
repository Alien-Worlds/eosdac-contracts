import {
  Account,
  AccountManager,
  sleep,
  EOSManager,
  debugPromise,
  assertEOSErrorIncludesMessage,
  assertRowCount,
  assertMissingAuthority,
  assertRowsEqual,
  TableRowsResult,
  assertBalanceEqual,
  UpdateAuth,
  ContractDeployer,
} from 'lamington';

import * as chai from 'chai';

let contract;

describe('Safemath', () => {
  before(async () => {
    contract = await ContractDeployer.deployWithName('safemath', 'safemath');
  });
  it('testuint should work', async () => {
    await contract.testuint();
  });
  it('testint should work', async () => {
    await contract.testint();
  });
  it('testfloat should work', async () => {
    await contract.testfloat();
  });
  it('smoverflow should throw multiplication overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.smoverflow(),
      'signed multiplication overflow Smoverflow 1 2 testname'
    );
  });
  it('umoverflow should throw multiplication overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.umoverflow(),
      'unsigned multiplication overflow'
    );
  });
  it('aoverflow should throw addition overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.aoverflow(),
      'signed addition overflow'
    );
  });
  it('auoverflow should throw addition overflow error', async () => {
    await assertEOSErrorIncludesMessage(contract.auoverflow(), 'unsigned wrap');
  });
  it('uunderflow should throw invalid unsigned subtraction error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.uunderflow(),
      'invalid unsigned subtraction: uint64_t 1 - 2 result would be negative'
    );
  });
  it('usdivzero should throw invalid unsigned subtraction error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.usdivzero(),
      'division by zero'
    );
  });
  it('sdivzero should throw division by zero error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.sdivzero(),
      'division by zero'
    );
  });
  it('fdivzero should throw division by zero error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.fdivzero(),
      'division by zero'
    );
  });

  it('sdivoverflow should throw division by zero error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.sdivoverflow(),
      'division overflow'
    );
  });
  it('infinity should infinity error', async () => {
    await assertEOSErrorIncludesMessage(contract.infinity(), 'infinity');
  });
  it('nan should throw NaN error', async () => {
    await assertEOSErrorIncludesMessage(contract.nan(), 'NaN');
  });
  it('convert1 should throw conversion overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.convert1(),
      'Invalid narrow cast'
    );
  });
  it('convert2 should throw Cannot convert negative value to unsigned error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.convert2(),
      'Invalid narrow cast'
    );
  });
  it('convert3 should throw conversion overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.convert3(),
      'Invalid narrow cast'
    );
  });
  it('convert4 should throw conversion overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.convert4(),
      'Invalid narrow cast'
    );
  });
  it('xxx1 should throw conversion overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.xxx1(),
      'invalid unsigned subtraction'
    );
  });
  it('xxx2 should work', async () => {
    await contract.xxx2();
  });
  it('xxx3 should work', async () => {
    await contract.xxx3();
  });
  it('xxx4 should throw signed subtraction underflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.xxx4(),
      'signed subtraction underflow'
    );
  });
  it('xxx5 should throw signed subtraction underflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.xxx5(),
      'signed subtraction overflow'
    );
  });
  it('yyy1 should throw overflow error', async () => {
    await assertEOSErrorIncludesMessage(contract.yyy1(), 'overflow');
  });
  it('yyy2 should throw overflow error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.yyy2(),
      'invalid unsigned subtraction'
    );
  });
  it('yyy3 should work', async () => {
    await contract.yyy3();
  });
  it('yyy4 should throw infinity error', async () => {
    await assertEOSErrorIncludesMessage(contract.yyy4(), 'infinity');
  });
  it('yyy5 should work', async () => {
    await contract.yyy5();
  });
  it('zzz1 should overflow rather than time out', async () => {
    await assertEOSErrorIncludesMessage(
      contract.zzz1(),
      'unsigned multiplication overflow'
    );
  });
  it('zzz2 should work', async () => {
    await contract.zzz2();
  });
  it('zzz3 should fail with signed multiplication overflow', async () => {
    await assertEOSErrorIncludesMessage(
      contract.zzz3(),
      'signed multiplication overflow'
    );
  });
  it('zzz4 should work', async () => {
    await contract.zzz4();
  });
  it('zzz5 should work', async () => {
    await contract.zzz5();
  });
  it('const1 should work', async () => {
    await contract.const1();
  });
  it('Floatc should error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.floatc(),
      'Float 256.500000 is too big for uint8_t ABC: 1, mouse'
    );
  });
  it('floatc1 should error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.floatc1(),
      'Float 128.500000 is too big for int8_t DEF: 2, cat'
    );
  });
  it('floatc2 should error', async () => {
    await assertEOSErrorIncludesMessage(
      contract.floatc2(),
      'Float -128.500000 is too big for int8_t floatc2 error given as to argument'
    );
  });
  it('floatc3 should work', async () => {
    await contract.floatc3();
  });
  it('floatmax should work', async () => {
    await contract.floatmax();
  });
  it('floatca should work', async () => {
    await contract.floatca();
  });
});
