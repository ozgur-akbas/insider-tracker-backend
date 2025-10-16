/**
 * Form 4 XML Parser - Fixed Version
 * Extracts insider trading data from SEC Form 4 XML documents
 * Handles whitespace and newlines properly
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
    const isDirector = xmlText.includes('<isDirector>1</isDirector>');
    const isOfficer = xmlText.includes('<isOfficer>1</isOfficer>');
    const isTenPercentOwner = xmlText.includes('<isTenPercentOwner>1</isTenPercentOwner>');
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
        
        // Extract values with flexible whitespace handling
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

        // Only include meaningful transactions
        if (shares > 0 && pricePerShare > 0 && date) {
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
 * Handles whitespace and newlines between tags
 */
function extractNestedValue(xml, tagName) {
  // Create regex pattern that matches: <tagName>...whitespace...<value>content</value>...whitespace...</tagName>
  const pattern = new RegExp(`<${tagName}[^>]*>\\s*<value>([^<]*)</value>\\s*</${tagName}>`, 'i');
  const match = xml.match(pattern);
  
  if (match && match[1]) {
    return match[1].trim();
  }
  
  return '';
}

