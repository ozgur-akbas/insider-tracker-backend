/**
 * SEC EDGAR Data Collector - FINAL WORKING VERSION
 * Removes strict Form 4 HTML check - relies on ownershipDocument instead
 */

import { parseForm4XML } from '../utils/xml-parser.js';
import { calculateScore } from '../utils/scoring.js';

const SEC_RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom';
const USER_AGENT = 'InsiderTrackerApp/1.0 ozgur.akbas@tresteams.com';

export async function collectInsiderData(db) {
  console.log('Starting SEC data collection...');
  
  try {
    // Fetch RSS feed
    const response = await fetch(SEC_RSS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/atom+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`SEC RSS fetch failed: ${response.status}`);
    }

    const xmlText = await response.text();
    
    // Extract URLs from RSS feed
    const indexURLs = extractURLs(xmlText);
    console.log(`Found ${indexURLs.length} URLs in RSS feed`);

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    // Process each URL (limit to 20 per run)
    for (const indexUrl of indexURLs.slice(0, 20)) {
      try {
        const result = await processForm4(indexUrl, db);
        if (result.processed) {
          processed++;
          console.log(`✓ Processed: ${result.ticker} (${result.transactions} transactions)`);
        } else {
          skipped++;
          console.log(`⊘ Skipped: ${result.reason}`);
        }
        
        // Rate limiting: 150ms delay = ~6.6 req/sec (SEC limit is 10 req/sec)
        await new Promise(resolve => setTimeout(resolve, 150));
        
      } catch (error) {
        console.error(`Error processing ${indexUrl}:`, error.message);
        errors++;
      }
    }

    console.log(`Collection complete: ${processed} processed, ${skipped} skipped, ${errors} errors`);

    return {
      success: true,
      message: 'Data collection completed',
      processed,
      skipped,
      errors,
      total_urls: indexURLs.length,
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

function extractURLs(xmlText) {
  const urls = [];
  const linkRegex = /<link\s+rel="alternate"[^>]*href="([^"]*)"/g;
  let match;

  while ((match = linkRegex.exec(xmlText)) !== null) {
    const url = match[1];
    if (url && url.includes('sec.gov') && url.includes('-index.htm')) {
      urls.push(url);
    }
  }

  return urls;
}

async function processForm4(indexUrl, db) {
  // Step 1: Fetch the index page
  const indexResponse = await fetch(indexUrl, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!indexResponse.ok) {
    return { processed: false, reason: `Index fetch failed: ${indexResponse.status}` };
  }

  const indexHtml = await indexResponse.text();

  // Step 2: Find XML file link
  let xmlFileName = null;
  
  // Try pattern 1: wf-form4_*.xml or doc4.xml
  let match = indexHtml.match(/<a[^>]*href="([^"]*(?:wf-form4|doc4|primary_doc)[^"]*\.xml)"[^>]*>/i);
  if (match) {
    xmlFileName = match[1];
  } else {
    // Try pattern 2: any XML file that's not filing fees or exhibits
    const allXmlMatches = indexHtml.matchAll(/<a[^>]*href="([^"]*\.xml)"[^>]*>/gi);
    for (const m of allXmlMatches) {
      const filename = m[1];
      // Skip filing fees and exhibits
      if (!filename.includes('filingfees') && !filename.includes('ex-') && !filename.includes('exhibit')) {
        xmlFileName = filename;
        break;
      }
    }
  }

  if (!xmlFileName) {
    return { processed: false, reason: 'No XML file found' };
  }

  // FIX 1: Remove XSL styling directory (returns HTML instead of XML)
  xmlFileName = xmlFileName.replace(/\/xslF345X05\//, '/');
  xmlFileName = xmlFileName.replace(/\/xslF345X04\//, '/');
  xmlFileName = xmlFileName.replace(/\/xslF345X03\//, '/');
  xmlFileName = xmlFileName.replace(/\/xslF345X02\//, '/');
  xmlFileName = xmlFileName.replace(/\/xslF345X01\//, '/');

  // FIX 2: Handle both absolute and relative XML paths
  let xmlUrl;
  if (xmlFileName.startsWith('/')) {
    // Absolute path from SEC root
    xmlUrl = 'https://www.sec.gov' + xmlFileName;
  } else if (xmlFileName.startsWith('http')) {
    // Full URL
    xmlUrl = xmlFileName;
  } else {
    // Relative path from index page directory
    const baseUrl = indexUrl.substring(0, indexUrl.lastIndexOf('/') + 1);
    xmlUrl = baseUrl + xmlFileName;
  }

  // Step 3: Fetch the XML file
  const xmlResponse = await fetch(xmlUrl, {
    headers: {
      'User-Agent': USER_AGENT
    }
  });

  if (!xmlResponse.ok) {
    return { processed: false, reason: `XML fetch failed: ${xmlResponse.status}` };
  }

  const xmlContent = await xmlResponse.text();
  
  // Step 4: Check if it's an ownership document (THIS is the real Form 4 check)
  if (!xmlContent.includes('ownershipDocument')) {
    return { processed: false, reason: 'Not an ownership document' };
  }

  // Step 5: Parse the Form 4 XML
  const data = parseForm4XML(xmlContent);

  if (!data || !data.transactions || data.transactions.length === 0) {
    return { processed: false, reason: 'No transactions found' };
  }

  // Step 6: Store in database
  const companyId = await upsertCompany(db, data.company);
  const insiderId = await upsertInsider(db, data.insider);

  let transactionCount = 0;
  for (const txn of data.transactions) {
    const inserted = await insertTransaction(db, companyId, insiderId, txn, xmlUrl);
    if (inserted) transactionCount++;
  }

  return {
    processed: true,
    ticker: data.company.ticker,
    transactions: transactionCount
  };
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
    return false; // Skip duplicate
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

  return true;
}
