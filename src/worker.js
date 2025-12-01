// Declare the allowed origin for CORS
const ALLOWED_ORIGIN = [
  "http://localhost:3000", // For local development
  "http://localhost:8787", // For local development
  "https://chienliu.com" // For production deployment
];

// Helper function to get CORS headers with the correct origin
function getCorsHeaders(requestOrigin) {
  const origin = ALLOWED_ORIGIN.includes(requestOrigin) ? requestOrigin : ALLOWED_ORIGIN[0];
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600', // Cache preflight response for 1 hour
  };
}

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get('Origin');

    // Block requests from disallowed origins or without Origin header
    if (!requestOrigin || !ALLOWED_ORIGIN.includes(requestOrigin)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    const CORS_HEADERS = getCorsHeaders(requestOrigin);

    // 1. Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204, // Correct status for preflight
        headers: CORS_HEADERS,
      });
    }

    try {
      // 2. Main Logic
      const { prompt } = await request.json();
      const response = await env.AI.run(
        "@cf/meta/llama-3-8b-instruct",
        {
          prompt: prompt,
        },
        {
          gateway: {
            id: "react-chatbot-gateway"
          },
        },
      );
      
      // 3. Successful Response
      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS, // Include all CORS headers on success
        },
      });
      
    } catch (e) {
      // 4. Error Handling (Crucial for CORS)
      const errorResponse = { error: 'Failed to process request.' };
      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...CORS_HEADERS, // Include CORS headers on error
        },
      });
    }
  },
}