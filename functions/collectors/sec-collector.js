/**
 * SEC EDGAR Data Collector - FIXED VERSION
 * Now properly filters for Form 4 filings only!
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
        'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)',
        'Accept': 'application/atom+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`SEC RSS fetch failed: ${response.status}`);
    }

    const xmlText = await response.text();
    
    // Parse RSS feed to get Form 4 index URLs (NOW PROPERLY FILTERED!)
    const indexURLs = extractForm4URLs(xmlText);
    console.log(`Found ${indexURLs.length} Form 4 filings`);

    let processed = 0;
    let errors = 0;

    // Process each Form 4 (limit to 20 per run to avoid timeout)
    for (const indexUrl of indexURLs.slice(0, 20)) {
      try {
        await processForm4(indexUrl, db);
        processed++;
      } catch (error) {
        console.error(`Error processing ${indexUrl}:`, error.message);
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
  
  // Split into entries
  const entries = xmlText.split('<entry>');
  
  for (const entry of entries) {
    if (!entry.includes('</entry>')) continue;
    
    // Check if this entry is a Form 4 (not 424B5, etc.)
    const categoryMatch = entry.match(/<category[^>]*term="([^"]*)"/);
    if (!categoryMatch || categoryMatch[1] !== '4') {
      continue; // Skip non-Form-4 entries
    }
    
    // Extract the link
    const linkMatch = entry.match(/<link\s+rel="alternate"[^>]*href="([^"]*)"/);
    if (linkMatch && linkMatch[1]) {
      urls.push(linkMatch[1]);
    }
  }

  return urls;
}

async function processForm4(indexUrl, db) {
  // Step 1: Fetch the index page to find the XML file
  const indexResponse = await fetch(indexUrl, {
    headers: {
      'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
    }
  });

  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch index page: ${indexResponse.status}`);
  }

  const indexHtml = await indexResponse.text();

  // Step 2: Extract XML file link from index page
  const xmlLinkMatch = indexHtml.match(/<a[^>]*href="([^"]*\.xml)"[^>]*>/i);
  
  if (!xmlLinkMatch) {
    throw new Error('No XML file found in index page');
  }

  const xmlFileName = xmlLinkMatch[1];
  const baseUrl = indexUrl.substring(0, indexUrl.lastIndexOf('/') + 1);
  const xmlUrl = baseUrl + xmlFileName;

  // Step 3: Fetch the XML file
  const xmlResponse = await fetch(xmlUrl, {
    headers: {
      'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
    }
  });

  if (!xmlResponse.ok) {
    throw new Error(`Failed to fetch XML: ${xmlResponse.status}`);
  }

  const xmlContent = await xmlResponse.text();

  // Step 4: Parse the Form 4 XML
  const data = parseForm4XML(xmlContent);

  if (!data) {
    throw new Error('Failed to parse Form 4 XML');
  }

  // Step 5: Store in database
  const companyId = await upsertCompany(db, data.company);
  const insiderId = await upsertInsider(db, data.insider);

  for (const txn of data.transactions) {
    await insertTransaction(db, companyId, insiderId, txn, xmlUrl);
  }
}

async function upsertCompany(db, company) {
  const existing = await db.prepare(
    'SELECT id FROM companies WHERE cik = ?'
  ).bind(company.cik).first();

  if (existing) {
    return existing.id;
  }

  const result = await db.prepare(
    'INSERT INTO companies (ticker, name, cik) VALUES (?, ?, ?)'
  ).bind(company.ticker, company.name, company.cik).run();

  return result.meta.last_row_id;
}

async function upsertInsider(db, insider) {
  const existing = await db.prepare(
    'SELECT id FROM insiders WHERE cik = ?'
  ).bind(insider.cik).first();

  if (existing) {
    return existing.id;
  }

  const result = await db.prepare(
    'INSERT INTO insiders (name, cik) VALUES (?, ?)'
  ).bind(insider.name, insider.cik).run();

  return result.meta.last_row_id;
}

async function insertTransaction(db, companyId, insiderId, txn, form4Url) {
  // Check for duplicates
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
  const companies = await db.prepare(
    'SELECT id FROM companies'
  ).all();

  for (const company of companies.results) {
    const transactions = await db.prepare(`
      SELECT * FROM transactions 
      WHERE company_id = ? 
      AND filing_date >= date('now', '-30 days')
    `).bind(company.id).all();

    const score = calculateScore(transactions.results);

    await db.prepare(
      'UPDATE companies SET significance_score = ? WHERE id = ?'
    ).bind(score, company.id).run();
  }
}

async function detectClusterBuys(db) {
  // Find companies with multiple insider purchases in the last 7 days
  const clusters = await db.prepare(`
    SELECT 
      company_id,
      COUNT(DISTINCT insider_id) as insider_count,
      SUM(transaction_value) as total_value,
      MAX(filing_date) as latest_filing
    FROM transactions
    WHERE is_purchase = 1
    AND filing_date >= date('now', '-7 days')
    GROUP BY company_id
    HAVING insider_count >= 2
  `).all();

  // Mark these as cluster buys
  for (const cluster of clusters.results) {
    await db.prepare(
      'UPDATE companies SET is_cluster_buy = 1 WHERE id = ?'
    ).bind(cluster.company_id).run();
  }
}

