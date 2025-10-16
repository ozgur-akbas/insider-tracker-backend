/**
 * SEC EDGAR Data Collector - DEBUG VERSION
 * Returns detailed information about what's happening
 */

import { parseForm4XML } from '../utils/xml-parser.js';
import { calculateScore } from '../utils/scoring.js';

const SEC_RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom';

export async function collectInsiderDataDebug(db) {
  const debugInfo = {
    steps: [],
    urls: [],
    parsed: [],
    errors: []
  };
  
  try {
    // Step 1: Fetch RSS feed
    debugInfo.steps.push('Fetching RSS feed...');
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
    debugInfo.steps.push('RSS feed fetched successfully');
    
    // Step 2: Extract URLs
    const indexURLs = extractForm4URLs(xmlText);
    debugInfo.steps.push(`Found ${indexURLs.length} Form 4 URLs`);
    debugInfo.urls = indexURLs.slice(0, 5); // First 5 for debugging

    // Step 3: Process first filing only for debugging
    if (indexURLs.length > 0) {
      const testUrl = indexURLs[0];
      debugInfo.steps.push(`Testing first URL: ${testUrl}`);
      
      try {
        // Fetch index page
        const indexResponse = await fetch(testUrl, {
          headers: {
            'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
          }
        });
        
        if (!indexResponse.ok) {
          throw new Error(`Index fetch failed: ${indexResponse.status}`);
        }
        
        const indexHtml = await indexResponse.text();
        debugInfo.steps.push('Index page fetched');
        
        // Extract XML link
        const xmlLinkMatch = indexHtml.match(/<a[^>]*href="([^"]*\.xml)"[^>]*>/i);
        
        if (!xmlLinkMatch) {
          debugInfo.steps.push('ERROR: No XML link found in index page');
          debugInfo.indexPageSample = indexHtml.substring(0, 500);
        } else {
          const xmlFileName = xmlLinkMatch[1];
          const baseUrl = testUrl.substring(0, testUrl.lastIndexOf('/') + 1);
          const xmlUrl = baseUrl + xmlFileName;
          
          debugInfo.steps.push(`XML URL: ${xmlUrl}`);
          
          // Fetch XML
          const xmlResponse = await fetch(xmlUrl, {
            headers: {
              'User-Agent': 'InsiderTrackerApp/1.0 (https://insider-tracker-frontend.vercel.app; ozgurakbas@example.com)'
            }
          });
          
          if (!xmlResponse.ok) {
            throw new Error(`XML fetch failed: ${xmlResponse.status}`);
          }
          
          const xmlContent = await xmlResponse.text();
          debugInfo.steps.push(`XML fetched (${xmlContent.length} bytes)`);
          debugInfo.xmlSample = xmlContent.substring(0, 1000);
          
          // Parse XML
          const data = parseForm4XML(xmlContent);
          
          if (!data) {
            debugInfo.steps.push('ERROR: Parser returned null');
          } else {
            debugInfo.steps.push('Parser succeeded!');
            debugInfo.parsed.push({
              company: data.company,
              insider: data.insider,
              transactionCount: data.transactions.length,
              firstTransaction: data.transactions[0]
            });
            
            // Try to insert into database
            try {
              const companyId = await upsertCompany(db, data.company);
              debugInfo.steps.push(`Company inserted: ID ${companyId}`);
              
              const insiderId = await upsertInsider(db, data.insider);
              debugInfo.steps.push(`Insider inserted: ID ${insiderId}`);
              
              for (const txn of data.transactions) {
                await insertTransaction(db, companyId, insiderId, txn, xmlUrl);
              }
              debugInfo.steps.push(`${data.transactions.length} transaction(s) inserted`);
              
            } catch (dbError) {
              debugInfo.steps.push(`DATABASE ERROR: ${dbError.message}`);
              debugInfo.errors.push(dbError.message);
            }
          }
        }
      } catch (error) {
        debugInfo.steps.push(`ERROR: ${error.message}`);
        debugInfo.errors.push(error.message);
      }
    }

    return {
      success: true,
      debug: debugInfo
    };

  } catch (error) {
    debugInfo.errors.push(error.message);
    return {
      success: false,
      error: error.message,
      debug: debugInfo
    };
  }
}

function extractForm4URLs(xmlText) {
  const urls = [];
  const entryRegex = /<link\s+rel="alternate"[^>]*href="([^"]*)"/g;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const url = match[1];
    if (url && url.includes('sec.gov')) {
      urls.push(url);
    }
  }

  return urls;
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
    'INSERT INTO insiders (name, cik) VALUES (?, ?, ?)'
  ).bind(insider.name, insider.cik).run();

  return result.meta.last_row_id;
}

async function insertTransaction(db, companyId, insiderId, txn, form4Url) {
  const existing = await db.prepare(`
    SELECT id FROM transactions 
    WHERE company_id = ? 
    AND insider_id = ? 
    AND transaction_date = ? 
    AND shares = ?
  `).bind(companyId, insiderId, txn.date, txn.shares).first();

  if (existing) {
    return;
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

