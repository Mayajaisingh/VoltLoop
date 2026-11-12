const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GENESIS_HASH, hashBlock, verifyBlocks } = require('../blockchain');

function fixture() {
  const genesis = { block_index: 0, timestamp: '2026-01-01T00:00:00.000Z', battery_vin: 'GENESIS',
    event_type: 'GENESIS', actor_role: 'admin', actor_org: 'EU Compliance', details: '{}', previous_hash: GENESIS_HASH };
  genesis.current_hash = hashBlock(genesis);
  const mint = { ...genesis, block_index: 1, battery_vin: 'VL-EU-2026-0001', event_type: 'PASSPORT_MINTED',
    details: '{"capacity_kwh":80}', previous_hash: genesis.current_hash };
  mint.current_hash = hashBlock(mint);
  return [genesis, mint];
}

test('verifies valid SHA-256 ledger', () => assert.equal(verifyBlocks(fixture()).valid, true));
test('detects unauthorized payload edits', () => {
  const blocks = fixture();
  blocks[1].details = '{"capacity_kwh":800}';
  assert.equal(verifyBlocks(blocks).failedBlock, 1);
});
test('detects broken links even after a block is rehashed', () => {
  const blocks = fixture();
  blocks[1].previous_hash = GENESIS_HASH;
  blocks[1].current_hash = hashBlock(blocks[1]);
  assert.equal(verifyBlocks(blocks).valid, false);
});