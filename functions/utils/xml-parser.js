/**
 * Form 4 XML Parser - FIXED VERSION - Hopefully
 * Handles footnotes in price fields
 */

export function parseForm4XML(xmlText) {
  try {
    // Extract company info
    const company = {
      ticker: extractValue(xmlText, '<issuerTradingSymbol>', '</issuerTradingSymbol>'),
      name: extractValue(xmlText, '<issuerName>', '</issuerName>'),
      cik: extractValue(xmlText, '<issuerCik>', '</issuerCik>')
    };

    // Extract insider info
    const insider = {
      name: extractValue(xmlText, '<rptOwnerName>', '</rptOwnerName>'),
      cik: extractValue(xmlText, '<rptOwnerCik>', '</rptOwnerCik>')
    };

    // Extract insider role
    const isDirector = xmlText.includes('<isDirector>true</isDirector>');
    const isOfficer = xmlText.includes('<isOfficer>true</isOfficer>');
    const isTenPercentOwner = xmlText.includes('<isTenPercentOwner>true</isTenPercentOwner>');
    const officerTitle = extractValue(xmlText, '<officerTitle>', '</officerTitle>');

    let insiderRole = '';
    if (isOfficer && officerTitle) {
      insiderRole = officerTitle;
    } else if (isDirector) {
      insiderRole = 'Director';
    } else if (isTenPercentOwner) {
      insiderRole = '10% Owner';
    } else {
      insiderRole = 'Other';
    }

    // Extract transactions
    const transactions = [];
    const nonDerivativeTableRegex = /<nonDerivativeTable>([\s\S]*?)<\/nonDerivativeTable>/g;
    const tableMatch = nonDerivativeTableRegex.exec(xmlText);

    if (tableMatch) {
      const tableXML = tableMatch[1];
      const transactionRegex = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/g;
      let txnMatch;

      while ((txnMatch = transactionRegex.exec(tableXML)) !== null) {
        const txnXML = txnMatch[1];
        
        // Extract values - FIXED to handle footnotes
        const shares = parseFloat(extractNestedValue(txnXML, 'transactionShares')) || 0;
        const pricePerShare = parseFloat(extractNestedValue(txnXML, 'transactionPricePerShare')) || 0;
        const date = extractNestedValue(txnXML, 'transactionDate');
        const code = extractValue(txnXML, '<transactionCode>', '</transactionCode>');
        const acquiredDisposed = extractNestedValue(txnXML, 'transactionAcquiredDisposedCode');
        const ownershipAfter = parseFloat(extractNestedValue(txnXML, 'sharesOwnedFollowingTransaction')) || 0;

        // Determine transaction type
        let type = 'Other';
        let isPurchase = false;

        if (code === 'P') {
          type = 'Purchase';
          isPurchase = true;
        } else if (code === 'S') {
          type = 'Sale';
          isPurchase = false;
        } else if (code === 'A') {
          type = 'Grant';
          isPurchase = true;
        } else if (code === 'M') {
          type = 'Exercise';
          isPurchase = true;
        }

        // Include transactions with shares > 0 (price can be 0 for grants)
        if (shares > 0 && date) {
          transactions.push({
            date,
            type,
            shares,
            pricePerShare,
            value: shares * pricePerShare,
            isPurchase,
            insiderRole,
            ownershipAfter
          });
        }
      }
    }

    // Validate data
    if (!company.ticker || !company.cik || !insider.name || !insider.cik || transactions.length === 0) {
      return null;
    }

    return {
      company,
      insider,
      transactions
    };

  } catch (error) {
    console.error('XML parsing error:', error);
    return null;
  }
}

function extractValue(xml, startTag, endTag) {
  const startIndex = xml.indexOf(startTag);
  if (startIndex === -1) return '';
  
  const valueStart = startIndex + startTag.length;
  const endIndex = xml.indexOf(endTag, valueStart);
  if (endIndex === -1) return '';
  
  return xml.substring(valueStart, endIndex).trim();
}

/**
 * Extract value from nested <tagName><value>content</value></tagName> structure
 * FIXED: Now handles optional footnoteId elements
 */
function extractNestedValue(xml, tagName) {
  // Pattern that matches <tagName>...<value>content</value>...</tagName>
  // Allows any content between tagName and value tags (including footnotes)
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, 'i');
  const match = xml.match(pattern);
  
  if (match && match[1]) {
    // Now extract the <value> tag from within
    const valueMatch = match[1].match(/<value>([^<]*)<\/value>/);
    if (valueMatch && valueMatch[1]) {
      return valueMatch[1].trim();
    }
  }
  
  return '';
}
