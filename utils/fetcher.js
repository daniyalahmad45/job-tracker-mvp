/**
 
Fetches a URL with a timeout and proper error handling.
@param {string} url - The URL to fetch
@param {number} timeoutMs - Timeout in milliseconds (default: 5000)
@returns {Promise<{success: boolean, data?: string, error?: string}>}*/
async function fetchWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const html = await response.text();
    return { success: true, data: html };

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timed out' };
    }

    return { 
      success: false, 
      error: error.message || 'Unknown error' 
    };
  }
}

module.exports = { fetchWithTimeout };