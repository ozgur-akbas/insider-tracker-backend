/**
 * SEC EDGAR Data Collector - BULLETPROOF VERSION
 * Verifies form type from actual page content, not RSS categories
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
    
    // Extract ALL URLs from RSS feed (we'll verify form type later)
    const indexURLs = extractAllURLs(xmlText);
    console.log(`Found ${indexURLs.length} URLs in RSS feed`);

    let processed = 0;
    let errors = 0;
    let skipped = 0;

    // Process each URL (limit to 20 per run to avoid timeout)
    for (const indexUrl of indexURLs.slice(0, 20)) {
      try {
        const wasProcessed = await processForm4(indexUrl, db);
        if (wasProcessed) {
          processed++;
        } else {
          skipped++;
        }
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
      skipped,
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

function extractAllURLs(xmlText) {
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
      'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
    }
  });

  if (!indexResponse.ok) {
    throw new Error(`Failed to fetch index page: ${indexResponse.status}`);
  }

  const indexHtml = await indexResponse.text();

  // Step 2: VERIFY THIS IS ACTUALLY A FORM 4!
  // Check the page title or form type in the content
  const titleMatch = indexHtml.match(/<title>([^<]*)<\/title>/i);
  const formTypeMatch = indexHtml.match(/Form\s+(\d+[A-Z]*)\s*-/i);
  
  if (titleMatch) {
    const title = titleMatch[1];
    // If title doesn't contain "Form 4" or contains other form numbers, skip it
    if (!title.includes('Form 4') && !title.includes('form 4')) {
      console.log(`Skipping non-Form-4: ${title}`);
      return false; // Not a Form 4, skip it
    }
  }
  
  if (formTypeMatch && formTypeMatch[1] !== '4') {
    console.log(`Skipping Form ${formTypeMatch[1]}`);
    return false; // Not a Form 4, skip it
  }

  // Step 3: Extract XML file link from index page
  // Form 4 XML files are usually named like "wf-form4_*.xml" or "doc4.xml" or similar
  const xmlLinkMatch = indexHtml.match(/<a[^>]*href="([^"]*(?:form4|doc4|ownership)[^"]*\.xml)"[^>]*>/i);
  
  if (!xmlLinkMatch) {
    // Try alternative pattern - any XML file
    const anyXmlMatch = indexHtml.match(/<a[^>]*href="([^"]*\.xml)"[^>]*>/i);
    if (!anyXmlMatch) {
      throw new Error('No XML file found in index page');
    }
    
    // Check if this XML is the ownership document by looking at the link text or nearby content
    const xmlFileName = anyXmlMatch[1];
    if (xmlFileName.includes('filingfees') || xmlFileName.includes('ex-')) {
      console.log(`Skipping non-ownership XML: ${xmlFileName}`);
      return false;
    }
  }

  const xmlFileName = xmlLinkMatch ? xmlLinkMatch[1] : indexHtml.match(/<a[^>]*href="([^"]*\.xml)"[^>]*>/i)[1];
  const baseUrl = indexUrl.substring(0, indexUrl.lastIndexOf('/') + 1);
  const xmlUrl = baseUrl + xmlFileName;

  // Step 4: Fetch the XML file
  const xmlResponse = await fetch(xmlUrl, {
    headers: {
      'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
    }
  });

  if (!xmlResponse.ok) {
    throw new Error(`Failed to fetch XML: ${xmlResponse.status}`);
  }

  const xmlContent = await xmlResponse.text();
  
  // Step 5: Verify this is an ownership document XML
  if (!xmlContent.includes('<ownershipDocument>') && !xmlContent.includes('ownershipDocument')) {
    console.log('Skipping non-ownership XML');
    return false;
  }

  // Step 6: Parse the Form 4 XML
  const data = parseForm4XML(xmlContent);

  if (!data) {
    throw new Error('Failed to parse Form 4 XML');
  }

  // Step 7: Store in database
  const companyId = await upsertCompany(db, data.company);
  const insiderId = await upsertInsider(db, data.insider);

  for (const txn of data.transactions) {
    await insertTransaction(db, companyId, insiderId, txn, xmlUrl);
  }
  
  return true; // Successfully processed
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

