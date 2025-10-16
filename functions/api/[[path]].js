// Cloudflare Pages Functions API Handler
// This handles all /api/* routes

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/', '');
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS for CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Route handling
    if (path === '' || path === 'health') {
      return handleHealth(corsHeaders);
    } else if (path === 'transactions') {
      return await handleTransactions(request, env.DB, corsHeaders);
    } else if (path === 'companies') {
      return await handleCompanies(request, env.DB, corsHeaders);
    } else if (path === 'companies/top') {
      return await handleTopCompanies(request, env.DB, corsHeaders);
    } else if (path.startsWith('companies/')) {
      const ticker = path.split('/')[1];
      return await handleCompanyDetail(ticker, env.DB, corsHeaders);
    } else if (path === 'clusters') {
      return await handleClusters(request, env.DB, corsHeaders);
    } else if (path === 'stats') {
      return await handleStats(env.DB, corsHeaders);
    } else if (path === 'collect') {
      return await handleCollect(env.DB, corsHeaders);
    } else if (path === 'debug-collect') {
      return await handleDebugCollect(env.DB, corsHeaders);
    }

    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: error.message }, 500, corsHeaders);
  }
}

// Helper function for JSON responses
function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

// Health check
function handleHealth(corsHeaders) {
  return jsonResponse({
    status: 'ok',
    message: 'Insider Tracker API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  }, 200, corsHeaders);
}

// Get transactions
async function handleTransactions(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const ticker = url.searchParams.get('ticker');
  const isPurchase = url.searchParams.get('is_purchase');

  let query = `
    SELECT t.*, c.ticker, c.name as company_name, i.name as insider_name
    FROM transactions t
    JOIN companies c ON t.company_id = c.id
    JOIN insiders i ON t.insider_id = i.id
    WHERE 1=1
  `;
  
  const params = [];
  
  if (ticker) {
    query += ` AND c.ticker = ?`;
    params.push(ticker);
  }
  
  if (isPurchase !== null && isPurchase !== undefined) {
    query += ` AND t.is_purchase = ?`;
    params.push(isPurchase === 'true' ? 1 : 0);
  }
  
  query += ` ORDER BY t.transaction_date DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const result = await db.prepare(query).bind(...params).all();
  
  return jsonResponse({
    transactions: result.results || [],
    count: result.results?.length || 0,
    limit,
    offset,
  }, 200, corsHeaders);
}

// Get companies
async function handleCompanies(request, db, corsHeaders) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search');
  
  let query = 'SELECT * FROM companies';
  const params = [];
  
  if (search) {
    query += ` WHERE ticker LIKE ? OR name LIKE ?`;
    params.push(`%${search}%`, `%${search}%`);
  }
  
  query += ` LIMIT 100`;
  
  const result = await db.prepare(query).bind(...params).all();
  
  return jsonResponse({
    companies: result.results || [],
  }, 200, corsHeaders);
}

// Get top companies by score
async function handleTopCompanies(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  
  const query = `
    SELECT c.*, cs.*
    FROM companies c
    JOIN company_scores cs ON c.id = cs.company_id
    WHERE cs.score > 50
    ORDER BY cs.score DESC
    LIMIT ?
  `;
  
  const result = await db.prepare(query).bind(limit).all();
  
  return jsonResponse({
    companies: result.results || [],
  }, 200, corsHeaders);
}

// Get company detail
async function handleCompanyDetail(ticker, db, corsHeaders) {
  const companyQuery = `
    SELECT c.*, cs.*
    FROM companies c
    LEFT JOIN company_scores cs ON c.id = cs.company_id
    WHERE c.ticker = ?
  `;
  
  const company = await db.prepare(companyQuery).bind(ticker).first();
  
  if (!company) {
    return jsonResponse({ error: 'Company not found' }, 404, corsHeaders);
  }
  
  const transactionsQuery = `
    SELECT t.*, i.name as insider_name
    FROM transactions t
    JOIN insiders i ON t.insider_id = i.id
    WHERE t.company_id = ?
    ORDER BY t.transaction_date DESC
    LIMIT 50
  `;
  
  const transactions = await db.prepare(transactionsQuery).bind(company.id).all();
  
  return jsonResponse({
    company,
    transactions: transactions.results || [],
  }, 200, corsHeaders);
}

// Get cluster buys
async function handleClusters(request, db, corsHeaders) {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const minScore = parseInt(url.searchParams.get('min_score') || '60');
  
  const query = `
    SELECT cb.*, c.ticker, c.name as company_name
    FROM cluster_buys cb
    JOIN companies c ON cb.company_id = c.id
    WHERE cb.score >= ?
    ORDER BY cb.score DESC, cb.cluster_date DESC
    LIMIT ?
  `;
  
  const result = await db.prepare(query).bind(minScore, limit).all();
  
  return jsonResponse({
    clusters: result.results || [],
  }, 200, corsHeaders);
}

// Get statistics
async function handleStats(db, corsHeaders) {
  const stats = {};
  
  // Total transactions
  const totalTx = await db.prepare('SELECT COUNT(*) as count FROM transactions').first();
  stats.total_transactions = totalTx?.count || 0;
  
  // Total companies
  const totalCo = await db.prepare('SELECT COUNT(*) as count FROM companies').first();
  stats.total_companies = totalCo?.count || 0;
  
  // Purchases vs sales (last 30 days)
  const purchases = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions 
    WHERE is_purchase = 1 AND transaction_date >= date('now', '-30 days')
  `).first();
  stats.purchases_30d = purchases?.count || 0;
  
  const sales = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions 
    WHERE is_purchase = 0 AND transaction_date >= date('now', '-30 days')
  `).first();
  stats.sales_30d = sales?.count || 0;
  
  // Cluster buys
  const clusters = await db.prepare('SELECT COUNT(*) as count FROM cluster_buys').first();
  stats.total_clusters = clusters?.count || 0;
  
  return jsonResponse(stats, 200, corsHeaders);
}

// Trigger data collection
async function handleCollect(db, corsHeaders) {
  try {
    const { collectInsiderData } = await import('../collectors/sec-collector.js');
    const result = await collectInsiderData(db);
    
    return jsonResponse({
      message: result.success ? 'Data collection completed' : 'Data collection failed',
      ...result
    }, result.success ? 200 : 500, corsHeaders);
  } catch (error) {
    console.error('Collection error:', error);
    return jsonResponse({
      error: 'Collection failed: ' + error.message,
      timestamp: new Date().toISOString()
    }, 500, corsHeaders);
  }
}


async function handleDebugCollect(db, corsHeaders) {
  try {
    const { collectInsiderDataDebug } = await import('../collectors/sec-collector-debug.js');
    const result = await collectInsiderDataDebug(db);
    
    return jsonResponse(result, 200, corsHeaders);
  } catch (error) {
    console.error('Debug collection error:', error);
    return jsonResponse({
      error: 'Debug collection failed: ' + error.message,
      timestamp: new Date().toISOString()
    }, 500, corsHeaders);
  }
}
