/**
 * API Router - Handles all HTTP requests
 */

import { getTransactions, getRecentTransactions } from './transactions';
import { getCompanies, getCompanyDetail, getTopScored } from './companies';
import { getClusters, getLiveClusters } from './clusters';
import { getStats } from './stats';

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS request (CORS preflight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow GET requests
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  try {
    // Route requests
    if (path === '/' || path === '/health') {
      return jsonResponse({ 
        status: 'ok', 
        message: 'Insider Tracker API',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      }, 200, corsHeaders);
    }

    // Transactions endpoints
    if (path === '/transactions') {
      return await getTransactions(request, env.DB, corsHeaders);
    }
    if (path === '/transactions/recent') {
      return await getRecentTransactions(request, env.DB, corsHeaders);
    }

    // Companies endpoints
    if (path === '/companies') {
      return await getCompanies(request, env.DB, corsHeaders);
    }
    if (path === '/companies/top-scored') {
      return await getTopScored(request, env.DB, corsHeaders);
    }
    if (path.startsWith('/companies/')) {
      const ticker = path.split('/')[2];
      return await getCompanyDetail(ticker, env.DB, corsHeaders);
    }

    // Clusters endpoints
    if (path === '/clusters') {
      return await getClusters(request, env.DB, corsHeaders);
    }
    if (path === '/clusters/live') {
      return await getLiveClusters(env.DB, corsHeaders);
    }

    // Stats endpoint
    if (path === '/stats') {
      return await getStats(env.DB, corsHeaders);
    }

    // 404 Not Found
    return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    
  } catch (error) {
    console.error('Router error:', error);
    return jsonResponse({ 
      error: 'Internal server error',
      message: error.message 
    }, 500, corsHeaders);
  }
}

function jsonResponse(data, status = 200, additionalHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...additionalHeaders
    }
  });
}

