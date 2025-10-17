/**
 * SEC EDGAR Data Collector - DETAILED DEBUG VERSION
 * Shows exactly what's failing at each step
 */

import { parseForm4XML } from '../utils/xml-parser.js';

const SEC_RSS_URL = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&count=10&output=atom';
const USER_AGENT = 'InsiderTrackerApp/1.0 ozgur.akbas@tresteams.com';

export async function collectInsiderDataDebug(db) {
  const debugLog = [];
  
  debugLog.push('=== Starting SEC Data Collection Debug ===');
  debugLog.push(`Time: ${new Date().toISOString()}`);
  debugLog.push(`User-Agent: ${USER_AGENT}`);
  
  try {
    // Step 1: Fetch RSS feed
    debugLog.push('\n--- Step 1: Fetching RSS Feed ---');
    const response = await fetch(SEC_RSS_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/atom+xml'
      }
    });

    debugLog.push(`RSS Response Status: ${response.status}`);
    
    if (!response.ok) {
      debugLog.push(`ERROR: RSS fetch failed with status ${response.status}`);
      const errorText = await response.text();
      debugLog.push(`Error body: ${errorText.substring(0, 500)}`);
      return { success: false, debugLog };
    }

    const xmlText = await response.text();
    debugLog.push(`RSS Feed Length: ${xmlText.length} characters`);
    debugLog.push(`First 200 chars: ${xmlText.substring(0, 200)}`);
    
    // Step 2: Extract URLs
    debugLog.push('\n--- Step 2: Extracting URLs ---');
    const urls = extractURLs(xmlText);
    debugLog.push(`Found ${urls.length} URLs`);
    if (urls.length > 0) {
      debugLog.push(`First URL: ${urls[0]}`);
    }

    // Step 3: Process first filing only
    if (urls.length === 0) {
      debugLog.push('ERROR: No URLs found in RSS feed');
      return { success: false, debugLog };
    }

    debugLog.push('\n--- Step 3: Processing First Filing ---');
    const firstUrl = urls[0];
    debugLog.push(`Processing: ${firstUrl}`);

    try {
      // Fetch index page
      debugLog.push('Fetching index page...');
      const indexResponse = await fetch(firstUrl, {
        headers: { 'User-Agent': USER_AGENT }
      });
      
      debugLog.push(`Index Response Status: ${indexResponse.status}`);
      
      if (!indexResponse.ok) {
        debugLog.push(`ERROR: Index fetch failed`);
        const errorText = await indexResponse.text();
        debugLog.push(`Error: ${errorText.substring(0, 300)}`);
        return { success: false, debugLog };
      }

      const indexHtml = await indexResponse.text();
      debugLog.push(`Index HTML Length: ${indexHtml.length} characters`);

      // Find XML file
      debugLog.push('Looking for XML file...');
      let xmlFileName = null;
      
      const match = indexHtml.match(/<a[^>]*href="([^"]*(?:wf-form4|doc4|primary_doc)[^"]*\.xml)"[^>]*>/i);
      if (match) {
        xmlFileName = match[1];
        debugLog.push(`Found XML (pattern 1): ${xmlFileName}`);
      } else {
        const allXmlMatches = indexHtml.matchAll(/<a[^>]*href="([^"]*\.xml)"[^>]*>/gi);
        for (const m of allXmlMatches) {
          const filename = m[1];
          if (!filename.includes('filingfees') && !filename.includes('ex-') && !filename.includes('exhibit')) {
            xmlFileName = filename;
            debugLog.push(`Found XML (pattern 2): ${xmlFileName}`);
            break;
          }
        }
      }

      if (!xmlFileName) {
        debugLog.push('ERROR: No XML file found in index page');
        debugLog.push(`Index HTML sample: ${indexHtml.substring(0, 500)}`);
        return { success: false, debugLog };
      }

      // Fetch XML
      const baseUrl = firstUrl.substring(0, firstUrl.lastIndexOf('/') + 1);
      const xmlUrl = baseUrl + xmlFileName;
      debugLog.push(`XML URL: ${xmlUrl}`);

      const xmlResponse = await fetch(xmlUrl, {
        headers: { 'User-Agent': USER_AGENT }
      });

      debugLog.push(`XML Response Status: ${xmlResponse.status}`);

      if (!xmlResponse.ok) {
        debugLog.push(`ERROR: XML fetch failed`);
        return { success: false, debugLog };
      }

      const xmlContent = await xmlResponse.text();
      debugLog.push(`XML Content Length: ${xmlContent.length} characters`);
      debugLog.push(`XML starts with: ${xmlContent.substring(0, 200)}`);

      // Check if ownership document
      if (!xmlContent.includes('ownershipDocument')) {
        debugLog.push('ERROR: Not an ownership document');
        debugLog.push(`XML sample: ${xmlContent.substring(0, 500)}`);
        return { success: false, debugLog };
      }

      debugLog.push('✓ Confirmed ownership document');

      // Parse XML
      debugLog.push('Parsing Form 4 XML...');
      const data = parseForm4XML(xmlContent);

      if (!data) {
        debugLog.push('ERROR: Parser returned null');
        return { success: false, debugLog };
      }

      debugLog.push(`✓ Parsed successfully`);
      debugLog.push(`Company: ${data.company?.ticker} - ${data.company?.name}`);
      debugLog.push(`Insider: ${data.insider?.name}`);
      debugLog.push(`Transactions: ${data.transactions?.length || 0}`);

      if (data.transactions && data.transactions.length > 0) {
        debugLog.push('First transaction:');
        debugLog.push(JSON.stringify(data.transactions[0], null, 2));
      }

      // Try to save to database
      debugLog.push('\n--- Step 4: Saving to Database ---');
      
      try {
        // Test database connection
        const testQuery = await db.prepare('SELECT 1 as test').first();
        debugLog.push(`✓ Database connection OK: ${JSON.stringify(testQuery)}`);

        // Try to insert company
        const companyResult = await db.prepare(
          'INSERT OR IGNORE INTO companies (ticker, name, cik) VALUES (?, ?, ?)'
        ).bind(data.company.ticker, data.company.name, data.company.cik).run();
        
        debugLog.push(`Company insert result: ${JSON.stringify(companyResult)}`);

      } catch (dbError) {
        debugLog.push(`ERROR: Database operation failed`);
        debugLog.push(`DB Error: ${dbError.message}`);
        debugLog.push(`DB Stack: ${dbError.stack}`);
      }

      return { success: true, debugLog, data };

    } catch (processingError) {
      debugLog.push(`\nERROR during processing: ${processingError.message}`);
      debugLog.push(`Stack: ${processingError.stack}`);
      return { success: false, debugLog, error: processingError.message };
    }

  } catch (error) {
    debugLog.push(`\nFATAL ERROR: ${error.message}`);
    debugLog.push(`Stack: ${error.stack}`);
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
