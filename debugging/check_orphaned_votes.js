/* eslint-env node */
const { TableFetcher } = require('eosio-helpers');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

// Configuration
const ENDPOINT = 'https://wax.greymass.com';
const DAO_CONTRACT = 'dao.worlds';
const MAX = 2 ** 32;

// Global state
const dac_data = {}; // dac_id -> { votes, candidates }
const orphaned_votes = {}; // dac_id -> Array of orphaned vote records

/**
 * Fetch all DAC IDs from the DAC directory
 */
async function fetch_dac_ids() {
const dacs = await TableFetcher({
    codeContract: 'index.worlds',
    batch_size: 100,
    endpoint: ENDPOINT,
    limit: MAX,
    scope: 'index.worlds',
    table: 'dacs',
});

return dacs.map(dac => dac.dac_id);

}

/**
 * Fetch votes and candidates tables for a specific DAC
 */
async function fetch_dac_tables(dac_id) {
  console.log(`Fetching tables for DAC: ${dac_id}`);
  
  try {
    const [votes, candidates] = await Promise.all([
      TableFetcher({
        codeContract: DAO_CONTRACT,
        batch_size: 100,
        endpoint: ENDPOINT,
        limit: MAX,
        scope: dac_id,
        table: 'votes',
      }),
      TableFetcher({
        codeContract: DAO_CONTRACT,
        batch_size: 100,
        endpoint: ENDPOINT,
        limit: MAX,
        scope: dac_id,
        table: 'candidates',
      })
    ]);

    return { votes, candidates };
  } catch (error) {
    console.error(`Error fetching tables for DAC ${dac_id}:`, error.message);
    return { votes: [], candidates: [] };
  }
}

/**
 * Check for orphaned votes in a specific DAC
 */
function check_orphaned_votes(dac_id) {
  const { votes, candidates } = dac_data[dac_id];
  
  if (!votes || !candidates) {
    console.log(`No data available for DAC: ${dac_id}`);
    return;
  }

  console.log(`\nChecking DAC: ${dac_id}`);
  console.log(`- Total votes: ${votes.length}`);
  console.log(`- Total candidates: ${candidates.length}`);

  // Create a set of existing candidate names for fast lookup
  const existing_candidates = new Set(candidates.map(c => c.candidate_name));
  
  let orphaned_count = 0;
  let total_orphaned_references = 0;
  
  orphaned_votes[dac_id] = [];

  // Check each vote record
  for (const vote of votes) {
    const orphaned_candidates = [];
    
    // Check each candidate in the vote
    for (const candidate_name of vote.candidates) {
      if (!existing_candidates.has(candidate_name)) {
        orphaned_candidates.push(candidate_name);
        total_orphaned_references++;
      }
    }
    
    // If this vote has orphaned candidates, record it
    if (orphaned_candidates.length > 0) {
      orphaned_count++;
      orphaned_votes[dac_id].push({
        voter: vote.voter,
        vote_time_stamp: vote.vote_time_stamp,
        vote_count: vote.vote_count,
        total_candidates: vote.candidates.length,
        orphaned_candidates: orphaned_candidates,
        valid_candidates: vote.candidates.filter(c => existing_candidates.has(c)),
        full_vote_record: vote
      });
    }
  }

  if (orphaned_count > 0) {
    console.log(`\n🚨 ORPHANED VOTES DETECTED FOR DAC: ${dac_id}`);
    console.log(`- Votes with orphaned candidates: ${orphaned_count}/${votes.length}`);
    console.log(`- Total orphaned candidate references: ${total_orphaned_references}`);
    console.log(`- Percentage of affected votes: ${((orphaned_count / votes.length) * 100).toFixed(2)}%`);
  } else {
    console.log(`✅ No orphaned votes found for DAC: ${dac_id}`);
  }
}

/**
 * Print detailed report for orphaned votes
 */
function print_detailed_report() {
  console.log('\n' + '='.repeat(80));
  console.log('DETAILED ORPHANED VOTES REPORT');
  console.log('='.repeat(80));

  let total_affected_dacs = 0;
  let total_orphaned_votes = 0;
  let total_orphaned_references = 0;

  for (const [dac_id, orphaned] of Object.entries(orphaned_votes)) {
    if (orphaned.length > 0) {
      total_affected_dacs++;
      total_orphaned_votes += orphaned.length;
      
      console.log(`\n📋 DAC: ${dac_id}`);
      console.log(`   Orphaned votes: ${orphaned.length}`);
      
      // Group by orphaned candidate to see patterns
      const orphaned_candidates_summary = {};
      for (const vote of orphaned) {
        total_orphaned_references += vote.orphaned_candidates.length;
        for (const orphaned_cand of vote.orphaned_candidates) {
          if (!orphaned_candidates_summary[orphaned_cand]) {
            orphaned_candidates_summary[orphaned_cand] = [];
          }
          orphaned_candidates_summary[orphaned_cand].push(vote.voter);
        }
      }
      
      console.log(`   Orphaned candidates and their voters:`);
      for (const [candidate, voters] of Object.entries(orphaned_candidates_summary)) {
        console.log(`     • ${candidate}: ${voters.length} votes from [${voters.join(', ')}]`);
      }

      // Show some example vote records
      console.log(`   Example orphaned vote records:`);
      for (let i = 0; i < Math.min(3, orphaned.length); i++) {
        const vote = orphaned[i];
        const vote_date = dayjs.utc(vote.vote_time_stamp).format('YYYY-MM-DD HH:mm:ss UTC');
        console.log(`     ${i + 1}. Voter: ${vote.voter}`);
        console.log(`        Date: ${vote_date}`);
        console.log(`        Total candidates: ${vote.total_candidates}`);
        console.log(`        Valid candidates: [${vote.valid_candidates.join(', ')}]`);
        console.log(`        Orphaned candidates: [${vote.orphaned_candidates.join(', ')}]`);
      }
      
      if (orphaned.length > 3) {
        console.log(`     ... and ${orphaned.length - 3} more orphaned votes`);
      }
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total DACs affected: ${total_affected_dacs}`);
  console.log(`Total orphaned votes: ${total_orphaned_votes}`);
  console.log(`Total orphaned candidate references: ${total_orphaned_references}`);
  
  if (total_affected_dacs === 0) {
    console.log('🎉 No orphaned votes found across all DACs!');
  } else {
    console.log('\n⚠️  These orphaned votes indicate data inconsistency that may need to be addressed.');
    console.log('   Consider running the vote weight rebuild procedure or cleaning up the votes.');
  }
}

/**
 * Save results to JSON file for further analysis
 */
function save_results() {
  const fs = require('fs');
  const timestamp = dayjs().format('YYYY-MM-DD_HH-mm-ss');
  const filename = `orphaned_votes_report_${timestamp}.json`;
  
  const report = {
    timestamp: dayjs().toISOString(),
    endpoint: ENDPOINT,
    contract: DAO_CONTRACT,
    summary: {
      total_dacs_checked: Object.keys(dac_data).length,
      dacs_with_orphaned_votes: Object.keys(orphaned_votes).filter(dac_id => orphaned_votes[dac_id].length > 0).length,
      total_orphaned_votes: Object.values(orphaned_votes).reduce((sum, votes) => sum + votes.length, 0),
    },
    detailed_results: orphaned_votes,
    raw_data: dac_data
  };
  
  fs.writeFileSync(filename, JSON.stringify(report, null, 2));
  console.log(`\n💾 Detailed results saved to: ${filename}`);
}

/**
 * Main execution function
 */
async function main() {
  console.log('🔍 Checking for orphaned votes in daccustodian contract...');
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Contract: ${DAO_CONTRACT}`);
  
  try {
    // Fetch all DAC IDs
    const dac_ids = await fetch_dac_ids();
    console.log(`Found ${dac_ids.length} DACs to check: [${dac_ids.join(', ')}]`);
    
    // Fetch data for each DAC
    for (const dac_id of dac_ids) {
      dac_data[dac_id] = await fetch_dac_tables(dac_id);
      
      // Add a small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Check each DAC for orphaned votes
    for (const dac_id of dac_ids) {
      check_orphaned_votes(dac_id);
    }
    
    // Print detailed report
    print_detailed_report();
    
    // Save results
    save_results();
    
  } catch (error) {
    console.error('Error in main execution:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main, check_orphaned_votes, fetch_dac_tables };