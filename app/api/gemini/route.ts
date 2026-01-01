import { NextRequest, NextResponse } from 'next/server';

// -----------------------------
// In-Memory Rate Limiting
// -----------------------------

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const rateLimitMap = new Map<string, RateLimitEntry>();

// Configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20; // Allow 20 requests per minute per IP

function getRateLimitKey(request: NextRequest): string {
  // Try to get real IP from common headers
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  if (realIp) {
    return realIp;
  }
  
  // Fallback to a generic key
  return 'unknown';
}

function checkRateLimit(key: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  // Clean up expired entries periodically (simple approach)
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) {
        rateLimitMap.delete(k);
      }
    }
  }

  if (!entry || now > entry.resetAt) {
    // Create new window
    rateLimitMap.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }

  if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
    return { allowed: false, remaining: 0 };
  }

  // Increment counter
  entry.count++;
  return { allowed: true, remaining: MAX_REQUESTS_PER_WINDOW - entry.count };
}

// -----------------------------
// API Route Handler
// -----------------------------

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitKey = getRateLimitKey(request);
    const { allowed, remaining } = checkRateLimit(rateLimitKey);

    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Date.now() + RATE_LIMIT_WINDOW_MS),
          }
        }
      );
    }

    // Validate API key exists
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('GEMINI_API_KEY is not configured');
      return NextResponse.json(
        { error: 'Service configuration error' },
        { status: 500 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    
    if (!body || typeof body.prompt !== 'string') {
      return NextResponse.json(
        { error: 'Invalid request: "prompt" field must be a string' },
        { status: 400 }
      );
    }

    const { prompt } = body;

    // Validate prompt is not empty and not too long
    if (prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt cannot be empty' },
        { status: 400 }
      );
    }

    if (prompt.length > 50000) {
      return NextResponse.json(
        { error: 'Prompt is too long (max 50000 characters)' },
        { status: 400 }
      );
    }

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`Gemini API error: ${geminiResponse.status}`, errorText);
      
      return NextResponse.json(
        { error: `AI service error: ${geminiResponse.status}` },
        { status: geminiResponse.status }
      );
    }

    // Return Gemini's response directly
    const data = await geminiResponse.json();
    
    return NextResponse.json(data, {
      headers: {
        'X-RateLimit-Remaining': String(remaining),
      }
    });

  } catch (error) {
    console.error('Gemini API route error:', error);
    
    // Don't leak internal error details
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
