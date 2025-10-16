/**
 * Transactions API Endpoints
 */

export async function getTransactions(request, db, corsHeaders) {
  const url = new URL(request.url);
  const ticker = url.searchParams.get('ticker');
  const insiderName = url.searchParams.get('insider_name');
  const transactionType = url.searchParams.get('transaction_type');
  const minValue = url.searchParams.get('min_value');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = `
    SELECT 
      t.*,
      c.ticker, c.name as company_name,
      i.name as insider_name
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    JOIN insiders i ON t.insider_id = i.id
    WHERE 1=1
  `;
  
  const params = [];

  if (ticker) {
    query += ` AND c.ticker = ?`;
    params.push(ticker.toUpperCase());
  }

  if (insiderName) {
    query += ` AND i.name LIKE ?`;
    params.push(`%${insiderName}%`);
  }

  if (transactionType === 'purchase') {
    query += ` AND t.is_purchase = 1`;
  } else if (transactionType === 'sale') {
    query += ` AND t.is_purchase = 0`;
  }

  if (minValue) {
    query += ` AND t.transaction_value >= ?`;
    params.push(parseFloat(minValue));
  }

  query += ` ORDER BY t.transaction_date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await db.prepare(query).bind(...params).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length,
    limit,
    offset
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function getRecentTransactions(request, db, corsHeaders) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '7');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  const query = `
    SELECT 
      t.*,
      c.ticker, c.name as company_name,
      i.name as insider_name
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.transaction_date >= date('now', '-' || ? || ' days')
    ORDER BY t.transaction_date DESC
    LIMIT ?
  `;

  const { results } = await db.prepare(query).bind(days, limit).all();

  return new Response(JSON.stringify({
    data: results,
    count: results.length,
    days
  }), {
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

