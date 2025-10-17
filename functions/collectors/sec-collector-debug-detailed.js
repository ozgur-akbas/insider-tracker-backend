/**
 * Enhanced Debug Collector - Shows WHY filings are being skipped
 */

import { parseForm4XML } from '../utils/xml-parser.js';

const USER_AGENT = 'InsiderTrackerApp/1.0 ozgur.akbas@tresteams.com';
const SEC_RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=100&output=atom';

export async function collectInsiderDataDebug(db) {
  const debugLog = [];
  
  debugLog.push('=== Enhanced Debug - Shows Skip Reasons ===');
  debugLog.push(`Time: ${new Date().toISOString()}`);
  
  try {
    // Fetch RSS feed
    debugLog.push('\n--- Fetching RSS Feed ---');
    const response = await fetch(SEC_RSS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/atom+xml'
      }
    });

    debugLog.push(`RSS Status: ${response.status}`);
    const xmlText = await response.text();
    debugLog.push(`RSS Length: ${xmlText.length} chars`);
    
    // Extract URLs
    const urls = extractURLs(xmlText);
    debugLog.push(`\nFound ${urls.length} URLs`);
    
    // Process first 3 filings with detailed logging
    debugLog.push('\n--- Processing First 3 Filings ---');
    
    for (let i = 0; i < Math.min(3, urls.length); i++) {
      const url = urls[i];
      debugLog.push(`\n[Filing ${i + 1}] ${url}`);
      
      try {
        // Fetch index
        const indexResp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        debugLog.push(`  Index Status: ${indexResp.status}`);
        
        if (!indexResp.ok) {
          debugLog.push(`  ❌ SKIP: Failed to fetch index`);
          continue;
        }
        
        const indexHtml = await indexResp.text();
        
        // Check if Form 4
        if (!indexHtml.includes('Form 4</strong>')) {
          debugLog.push(`  ❌ SKIP: Not a Form 4`);
          continue;
        }
        debugLog.push(`  ✓ Confirmed Form 4`);
        
        // Find XML
        let xmlFileName = null;
        const match = indexHtml.match(/<a[^>]*href="([^"]*(?:wf-form4|doc4|primary_doc)[^"]*\.xml)"[^>]*>/i);
        if (match) {
          xmlFileName = match[1];
        } else {
          const allXmlMatches = indexHtml.matchAll(/<a[^>]*href="([^"]*\.xml)"[^>]*>/gi);
          for (const m of allXmlMatches) {
            const filename = m[1];
            if (!filename.includes('filingfees') && !filename.includes('ex-') && !filename.includes('exhibit')) {
              xmlFileName = filename;
              break;
            }
          }
        }
        
        if (!xmlFileName) {
          debugLog.push(`  ❌ SKIP: No XML file found`);
          continue;
        }
        
        debugLog.push(`  Found XML: ${xmlFileName}`);
        
        // Apply fixes
        const originalXml = xmlFileName;
        xmlFileName = xmlFileName.replace(/\/xslF345X05\//, '/');
        xmlFileName = xmlFileName.replace(/\/xslF345X04\//, '/');
        xmlFileName = xmlFileName.replace(/\/xslF345X03\//, '/');
        xmlFileName = xmlFileName.replace(/\/xslF345X02\//, '/');
        xmlFileName = xmlFileName.replace(/\/xslF345X01\//, '/');
        
        if (originalXml !== xmlFileName) {
          debugLog.push(`  Fixed XML: ${xmlFileName}`);
        }
        
        // Construct URL
        let xmlUrl;
        if (xmlFileName.startsWith('/')) {
          xmlUrl = 'https://www.sec.gov' + xmlFileName;
        } else if (xmlFileName.startsWith('http')) {
          xmlUrl = xmlFileName;
        } else {
          const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
          xmlUrl = baseUrl + xmlFileName;
        }
        
        debugLog.push(`  XML URL: ${xmlUrl}`);
        
        // Fetch XML
        const xmlResp = await fetch(xmlUrl, { headers: { 'User-Agent': USER_AGENT } });
        debugLog.push(`  XML Status: ${xmlResp.status}`);
        
        if (!xmlResp.ok) {
          debugLog.push(`  ❌ SKIP: Failed to fetch XML (${xmlResp.status})`);
          continue;
        }
        
        const xmlContent = await xmlResp.text();
        debugLog.push(`  XML Length: ${xmlContent.length} chars`);
        debugLog.push(`  First 100 chars: ${xmlContent.substring(0, 100)}`);
        
        // Check ownership document
        if (!xmlContent.includes('ownershipDocument')) {
          debugLog.push(`  ❌ SKIP: Not an ownership document`);
          debugLog.push(`  Content starts with: ${xmlContent.substring(0, 200)}`);
          continue;
        }
        
        debugLog.push(`  ✓ Confirmed ownership document`);
        
        // Parse
        const data = parseForm4XML(xmlContent);
        
        if (!data || !data.transactions || data.transactions.length === 0) {
          debugLog.push(`  ❌ SKIP: No transactions found`);
          debugLog.push(`  Parser returned: ${JSON.stringify(data)}`);
          continue;
        }
        
        debugLog.push(`  ✓ SUCCESS!`);
        debugLog.push(`  Company: ${data.company.ticker} - ${data.company.name}`);
        debugLog.push(`  Insider: ${data.insider.name}`);
        debugLog.push(`  Transactions: ${data.transactions.length}`);
        
        if (data.transactions.length > 0) {
          const txn = data.transactions[0];
          debugLog.push(`  First txn: ${txn.isPurchase ? 'BUY' : 'SELL'} ${txn.shares} shares @ $${txn.pricePerShare}`);
        }
        
      } catch (error) {
        debugLog.push(`  ❌ ERROR: ${error.message}`);
      }
    }
    
    return { success: true, debugLog };
    
  } catch (error) {
    debugLog.push(`\nFATAL ERROR: ${error.message}`);
    return { success: false, debugLog, error: error.message };
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
