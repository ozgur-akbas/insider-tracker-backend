/**
 * Insider Tracker - Cloudflare Worker
 * Main entry point for API and scheduled tasks
 */

import { handleRequest } from './api/router';
import { collectInsiderData } from './collectors/sec-collector';

export default {
  /**
   * Handle HTTP requests (API endpoints)
   */
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },

  /**
   * Handle scheduled tasks (Cron triggers)
   * Runs every 10 minutes to collect SEC data
   */
  async scheduled(event, env, ctx) {
    console.log('Cron trigger fired:', new Date().toISOString());
    
    try {
      // Collect insider trading data from SEC
      const result = await collectInsiderData(env.DB);
      console.log('Data collection result:', result);
    } catch (error) {
      console.error('Scheduled task error:', error);
    }
  }
};

