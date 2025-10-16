// Middleware for all requests
export async function onRequest(context) {
  // Add timing header
  const start = Date.now();
  const response = await context.next();
  const duration = Date.now() - start;
  
  response.headers.set('X-Response-Time', `${duration}ms`);
  
  return response;
}

