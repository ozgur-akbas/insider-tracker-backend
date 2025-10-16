/**
 * Form 4 XML Parser
 * Extracts insider trading data from SEC Form 4 XML documents
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
        
        const shares = parseFloat(extractValue(txnXML, '<transactionShares><value>', '</value>')) || 0;
        const pricePerShare = parseFloat(extractValue(txnXML, '<transactionPricePerShare><value>', '</value>')) || 0;
        const date = extractValue(txnXML, '<transactionDate><value>', '</value>');
        const code = extractValue(txnXML, '<transactionCode>', '</transactionCode>');
        const acquiredDisposed = extractValue(txnXML, '<transactionAcquiredDisposedCode><value>', '</value>');
        const ownershipAfter = parseFloat(extractValue(txnXML, '<sharesOwnedFollowingTransaction><value>', '</value>')) || 0;

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

