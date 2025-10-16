/**
 * Insider Activity Scoring System
 * Calculates a 0-100 score based on insider trading activity
 */

export function calculateScore(transactions) {
  let score = 50; // Start at neutral
  let numBuyers = 0;
  let numSellers = 0;
  let totalBuyValue = 0;
  let totalSellValue = 0;

  const buyers = new Set();
  const sellers = new Set();

  for (const txn of transactions) {
    if (txn.is_purchase) {
      buyers.add(txn.insider_id);
      totalBuyValue += txn.transaction_value;

      // Transaction type points
      if (txn.insider_role && (txn.insider_role.includes('CEO') || txn.insider_role.includes('CFO'))) {
        score += 15;
      } else if (txn.insider_role && txn.insider_role.includes('Director')) {
        score += 10;
      } else {
        score += 5;
      }

      // Transaction size points
      if (txn.transaction_value > 1000000) {
        score += 10;
      } else if (txn.transaction_value > 500000) {
        score += 7;
      } else if (txn.transaction_value > 100000) {
        score += 4;
      }

    } else {
      sellers.add(txn.insider_id);
      totalSellValue += txn.transaction_value;

      // Selling reduces score
      if (txn.insider_role && (txn.insider_role.includes('CEO') || txn.insider_role.includes('CFO'))) {
        score -= 15;
      } else if (txn.insider_role && txn.insider_role.includes('Director')) {
        score -= 10;
      } else {
        score -= 5;
      }

      // Large sales reduce score more
      if (txn.transaction_value > 1000000) {
        score -= 10;
      } else if (txn.transaction_value > 500000) {
        score -= 7;
      }
    }
  }

  numBuyers = buyers.size;
  numSellers = sellers.size;

  // Clustering bonus
  if (numBuyers >= 4) {
    score += 20;
  } else if (numBuyers >= 3) {
    score += 15;
  } else if (numBuyers >= 2) {
    score += 10;
  }

  // Multiple sellers penalty
  if (numSellers >= 3) {
    score -= 20;
  } else if (numSellers >= 2) {
    score -= 10;
  }

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine signal
  let signal;
  if (score >= 90) {
    signal = 'STRONG BUY';
  } else if (score >= 75) {
    signal = 'BUY';
  } else if (score >= 60) {
    signal = 'MODERATE BUY';
  } else if (score >= 40) {
    signal = 'NEUTRAL';
  } else if (score >= 25) {
    signal = 'MODERATE SELL';
  } else {
    signal = 'SELL';
  }

  return {
    score,
    signal,
    numBuyers,
    numSellers,
    totalBuyValue,
    totalSellValue
  };
}

