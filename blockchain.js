const crypto = require('node:crypto');

const GENESIS_HASH = '0'.repeat(64);

// An ordered tuple prevents ambiguous concatenation and commits every ledger field.
function hashBlock(block) {
  return crypto.createHash('sha256').update(JSON.stringify([
    block.block_index, block.previous_hash, block.timestamp, block.battery_vin,
    block.event_type, block.actor_role, block.actor_org, block.details
  ])).digest('hex');
}

function verifyBlocks(blocks) {
  let previousHash = GENESIS_HASH;
  for (let position = 0; position < blocks.length; position++) {
    const block = blocks[position];
    if (block.block_index !== position || block.previous_hash !== previousHash || hashBlock(block) !== block.current_hash) {
      return { valid: false, checked: position, failedBlock: block.block_index, message: `Integrity breach detected at block #${block.block_index}. Payload or chain link has changed.` };
    }
    previousHash = block.current_hash;
  }
  return { valid: blocks.length > 0, checked: blocks.length, latestHash: previousHash,
    message: blocks.length ? `All ${blocks.length} blocks verified. SHA-256 hashes and chain links match.` : 'Ledger is empty.' };
}

function verifyChain(db) {
  const result = verifyBlocks(db.prepare('SELECT * FROM blockchain_ledger ORDER BY block_index').all());
  if (!result.valid) return result;
  const checkpoint = db.prepare("SELECT value FROM platform_settings WHERE key = 'ledger_head'").get();
  if (!checkpoint || checkpoint.value !== result.latestHash) {
    return { ...result, valid: false, message: 'Ledger head does not match the stored checkpoint. Possible truncated chain.' };
  }
  const mismatch = db.prepare(`SELECT b.battery_vin FROM batteries b WHERE b.current_hash !=
    (SELECT current_hash FROM blockchain_ledger l WHERE l.battery_vin = b.battery_vin ORDER BY block_index DESC LIMIT 1)`).get();
  if (mismatch) return { ...result, valid: false, message: `Passport hash mismatch for ${mismatch.battery_vin}.` };
  return result;
}

function appendBlock(db, { battery_vin = 'GENESIS', event_type, actor_role, actor_org, details = {}, timestamp = new Date().toISOString() }) {
  const last = db.prepare('SELECT block_index, current_hash FROM blockchain_ledger ORDER BY block_index DESC LIMIT 1').get();
  const block = { block_index: last ? last.block_index + 1 : 0, timestamp, battery_vin, event_type,
    actor_role, actor_org, details: JSON.stringify(details), previous_hash: last ? last.current_hash : GENESIS_HASH };
  block.current_hash = hashBlock(block);
  db.prepare(`INSERT INTO blockchain_ledger (block_index,timestamp,battery_vin,event_type,actor_role,actor_org,details,previous_hash,current_hash)
    VALUES (@block_index,@timestamp,@battery_vin,@event_type,@actor_role,@actor_org,@details,@previous_hash,@current_hash)`).run(block);
  db.prepare('UPDATE batteries SET current_hash = ? WHERE battery_vin = ?').run(block.current_hash, battery_vin);
  db.prepare("INSERT INTO platform_settings (key,value) VALUES ('ledger_head',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(block.current_hash);
  return block;
}

module.exports = { GENESIS_HASH, hashBlock, verifyBlocks, verifyChain, appendBlock };