/**
 * SEC EDGAR Data Collector
 * Fetches and parses Form 4 filings from SEC RSS feed
 */

import { parseForm4XML } from '../utils/xml-parser.js';
import { calculateScore } from '../utils/scoring.js';

const SEC_RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom';

export async function collectInsiderData(db) {
  console.log('Starting SEC data collection...');
  
  try {
    // Fetch RSS feed
    const response = await fetch(SEC_RSS_URL, {
      headers: {
        'User-Agent': 'Insider Tracker App contact@insidertracker.com',
        'Accept': 'application/atom+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`SEC RSS fetch failed: ${response.status}`);
    }

    const xmlText = await response.text();
    
    // Parse RSS feed to get Form 4 URLs
    const form4URLs = extractForm4URLs(xmlText);
    console.log(`Found ${form4URLs.length} Form 4 filings`);

    let processed = 0;
    let errors = 0;

    // Process each Form 4 (limit to 20 per run to avoid timeout)
    for (const url of form4URLs.slice(0, 20)) {
      try {
        await processForm4(url, db);
        processed++;
      } catch (error) {
        console.error(`Error processing ${url}:`, error.message);
        errors++;
      }
    }

    // Update scores for all companies
    await updateAllScores(db);

    // Detect cluster buys
    await detectClusterBuys(db);

    return {
      success: true,
      processed,
      errors,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Data collection error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

function extractForm4URLs(xmlText) {
  const urls = [];
  // Match <link rel="alternate" ... href="..." /> pattern
  const entryRegex = /<link\s+rel="alternate"[^>]*href="([^"]*)"/g;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const url = match[1];
    // All links in Form 4 feed are valid, no need to filter
    if (url && url.includes('sec.gov')) {
      urls.push(url);
    }
  }

  return urls;
}

async function processForm4(url, db) {
  // Fetch Form 4 XML
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Insider Tracker App contact@insidertracker.com'
    }
  });

  if (!response.ok) {
    throw new Error(`Form 4 fetch failed: ${response.status}`);
  }

  const xmlText = await response.text();
  const data = parseForm4XML(xmlText);

  if (!data || !data.company || !data.insider || !data.transactions || data.transactions.length === 0) {
    return; // Skip if no valid data
  }

  // Insert or get company
  const companyId = await upsertCompany(db, data.company);

  // Insert or get insider
  const insiderId = await upsertInsider(db, data.insider);

  // Insert transactions
  for (const txn of data.transactions) {
    await insertTransaction(db, companyId, insiderId, txn, url);
  }
}

async function upsertCompany(db, company) {
  // Try to get existing company
  const existing = await db.prepare(
    'SELECT id FROM companies WHERE cik = ?'
  ).bind(company.cik).first();

  if (existing) {
    return existing.id;
  }

  // Insert new company
  const result = await db.prepare(
    'INSERT INTO companies (ticker, name, cik) VALUES (?, ?, ?)'
  ).bind(company.ticker, company.name, company.cik).run();

  return result.meta.last_row_id;
}

async function upsertInsider(db, insider) {
  // Try to get existing insider
  const existing = await db.prepare(
    'SELECT id FROM insiders WHERE cik = ?'
  ).bind(insider.cik).first();

  if (existing) {
    return existing.id;
  }

  // Insert new insider
  const result = await db.prepare(
    'INSERT INTO insiders (name, cik) VALUES (?, ?)'
  ).bind(insider.name, insider.cik).run();

  return result.meta.last_row_id;
}

async function insertTransaction(db, companyId, insiderId, txn, form4Url) {
  // Check if transaction already exists
  const existing = await db.prepare(`
    SELECT id FROM transactions 
    WHERE company_id = ? 
    AND insider_id = ? 
    AND transaction_date = ? 
    AND shares = ?
  `).bind(companyId, insiderId, txn.date, txn.shares).first();

  if (existing) {
    return; // Skip duplicate
  }

  // Insert transaction
  await db.prepare(`
    INSERT INTO transactions (
      company_id, insider_id, transaction_date, transaction_type,
      shares, price_per_share, transaction_value, is_purchase,
      insider_role, ownership_after, filing_date, form4_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now'), ?)
  `).bind(
    companyId,
    insiderId,
    txn.date,
    txn.type,
    txn.shares,
    txn.pricePerShare,
    txn.value,
    txn.isPurchase ? 1 : 0,
    txn.insiderRole || null,
    txn.ownershipAfter || null,
    form4Url
  ).run();
}

async function updateAllScores(db) {
  // Get all companies with recent transactions
  const companies = await db.prepare(`
    SELECT DISTINCT company_id 
    FROM transactions 
    WHERE transaction_date >= date('now', '-30 days')
  `).all();

  for (const { company_id } of companies.results || []) {
    await updateCompanyScore(db, company_id);
  }
}

async function updateCompanyScore(db, companyId) {
  // Get transactions from last 30 days
  const { results: transactions } = await db.prepare(`
    SELECT * FROM transactions
    WHERE company_id = ?
    AND transaction_date >= date('now', '-30 days')
  `).bind(companyId).all();

  if (!transactions || transactions.length === 0) {
    return;
  }

  // Calculate score
  const scoreData = calculateScore(transactions);

  // Upsert score
  await db.prepare(`
    INSERT INTO company_scores (
      company_id, score, signal, 
      num_buyers_30d, num_sellers_30d,
      total_buy_value_30d, total_sell_value_30d,
      num_transactions_30d, last_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(company_id) DO UPDATE SET
      score = excluded.score,
      signal = excluded.signal,
      num_buyers_30d = excluded.num_buyers_30d,
      num_sellers_30d = excluded.num_sellers_30d,
      total_buy_value_30d = excluded.total_buy_value_30d,
      total_sell_value_30d = excluded.total_sell_value_30d,
      num_transactions_30d = excluded.num_transactions_30d,
      last_updated = excluded.last_updated
  `).bind(
    companyId,
    scoreData.score,
    scoreData.signal,
    scoreData.numBuyers,
    scoreData.numSellers,
    scoreData.totalBuyValue,
    scoreData.totalSellValue,
    transactions.length
  ).run();
}

async function detectClusterBuys(db) {
  // Find companies with 2+ insiders buying in last 7 days
  const { results: clusters } = await db.prepare(`
    SELECT 
      company_id,
      date(transaction_date) as cluster_date,
      COUNT(DISTINCT insider_id) as num_insiders,
      COUNT(*) as num_transactions,
      SUM(transaction_value) as total_value,
      SUM(shares) as total_shares
    FROM transactions
    WHERE is_purchase = 1
    AND transaction_date >= date('now', '-7 days')
    GROUP BY company_id, date(transaction_date)
    HAVING COUNT(DISTINCT insider_id) >= 2
  `).all();

  for (const cluster of clusters || []) {
    // Check if cluster already exists
    const existing = await db.prepare(`
      SELECT id FROM cluster_buys
      WHERE company_id = ? AND cluster_date = ?
    `).bind(cluster.company_id, cluster.cluster_date).first();

    if (existing) {
      continue;
    }

    // Calculate cluster score (based on number of insiders and total value)
    const score = Math.min(100, 
      (cluster.num_insiders * 20) + 
      Math.min(40, Math.floor(cluster.total_value / 100000))
    );

    // Insert cluster
    await db.prepare(`
      INSERT INTO cluster_buys (
        company_id, cluster_date, num_insiders, num_transactions,
        total_value, total_shares, score
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      cluster.company_id,
      cluster.cluster_date,
      cluster.num_insiders,
      cluster.num_transactions,
      cluster.total_value,
      cluster.total_shares,
      score
    ).run();
  }
}

