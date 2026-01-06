const puppeteer = require('puppeteer');

/**
 * Detects if a URL is a Workday job board
 */
function isWorkday(url) {
  return url.includes('myworkdayjobs.com') || url.includes('wd3.') || url.includes('wd5.');
}

/**
 * Sleep function to replace deprecated waitForTimeout
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scrapes Workday job boards specifically
 */
async function scrapeWorkday(page) {
  console.log('Scraping Workday site...');
  
  // Wait for any of these selectors (different Workday versions)
  try {
    await Promise.race([
      page.waitForSelector('[data-automation-id="jobTitle"]', { timeout: 15000 }),
      page.waitForSelector('a[aria-label*="job"]', { timeout: 15000 }),
      page.waitForSelector('[class*="css"][role="listitem"]', { timeout: 15000 }),
      page.waitForSelector('li a[href*="job"]', { timeout: 15000 })
    ]);
  } catch (e) {
    console.log('Initial wait failed, trying to extract anyway...');
  }

  // Give it more time to load
  await sleep(3000);

  // Scroll to load more jobs
  await autoScroll(page);
  await sleep(2000);

  // Extract jobs from Workday with multiple strategies
  const jobs = await page.evaluate(() => {
    const jobElements = [];
    
    // Strategy 1: Look for job title automation IDs
    let jobLinks = document.querySelectorAll('a[data-automation-id="jobTitle"]');
    
    // Strategy 2: If not found, look for links with "job" in href
    if (jobLinks.length === 0) {
      jobLinks = document.querySelectorAll('a[href*="/job/"]');
    }
    
    // Strategy 3: Look for aria-labels with job info
    if (jobLinks.length === 0) {
      jobLinks = document.querySelectorAll('a[aria-label*="job"]');
    }

    // Strategy 4: Generic link search in list items
    if (jobLinks.length === 0) {
      const listItems = document.querySelectorAll('li[role="listitem"], li[class*="css"]');
      jobLinks = Array.from(listItems).map(li => li.querySelector('a')).filter(a => a);
    }
    
    console.log('Found', jobLinks.length, 'job links');
    
    jobLinks.forEach((link, index) => {
      let title = link.textContent.trim();
      
      // Clean up title (remove extra whitespace)
      title = title.replace(/\s+/g, ' ').trim();
      
      const url = link.href;
      
      // Try to find location
      let location = 'Location not specified';
      const parent = link.closest('li') || link.closest('[role="listitem"]');
      
      if (parent) {
        // Look for location in various ways
        const locationEl = parent.querySelector('[data-automation-id*="location"]') || 
                          parent.querySelector('dd') ||
                          parent.querySelector('[class*="location"]');
        
        if (locationEl) {
          location = locationEl.textContent.trim();
        } else {
          // Try to extract from text content
          const text = parent.textContent;
          const locationMatch = text.match(/([A-Z][a-z]+,\s*[A-Z]{2})|([A-Z][a-z\s]+,\s*[A-Z][a-z\s]+)/);
          if (locationMatch) {
            location = locationMatch[0];
          }
        }
      }

      if (title && url && title.length > 3) {
        jobElements.push({
          id: index + 1,
          title: title,
          location: location,
          url: url
        });
      }
    });

    return jobElements;
  });

  console.log('Extracted', jobs.length, 'jobs from Workday');
  return jobs;
}

/**
 * Auto-scroll function to trigger lazy loading
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight || totalHeight > 3000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

/**
 * Generic scraper for other sites
 */
async function scrapeGeneric(page) {
  const jobs = await page.evaluate(() => {
    const jobElements = [];
    
    // Common job listing selectors
    const selectors = [
      'a[href*="/job"]',
      'a[href*="/position"]',
      'a[href*="/career"]',
      '[data-job-id]',
      '.job-listing',
      '.job-item',
      '.opening',
      '[class*="job"]',
      '[class*="position"]',
      '[class*="career"]'
    ];

    let foundElements = [];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      if (elements.length > 0) {
        foundElements = Array.from(elements);
        break;
      }
    }

    // Extract job information
    foundElements.forEach((el, index) => {
      // Try to find title
      let title = '';
      const titleSelectors = ['h2', 'h3', 'h4', '.title', '[class*="title"]', 'a'];
      for (const sel of titleSelectors) {
        const titleEl = el.querySelector(sel);
        if (titleEl && titleEl.textContent.trim()) {
          title = titleEl.textContent.trim();
          break;
        }
      }

      // If element itself is a link with text, use that
      if (!title && el.tagName === 'A' && el.textContent.trim()) {
        title = el.textContent.trim();
      }

      // Try to find location
      let location = 'Location not specified';
      const locationSelectors = ['.location', '[class*="location"]', '[class*="office"]', '[data-location]'];
      for (const sel of locationSelectors) {
        const locEl = el.querySelector(sel);
        if (locEl && locEl.textContent.trim()) {
          location = locEl.textContent.trim();
          break;
        }
      }

      // Try to find URL
      let jobUrl = '';
      if (el.tagName === 'A') {
        jobUrl = el.href;
      } else {
        const link = el.querySelector('a');
        if (link) {
          jobUrl = link.href;
        }
      }

      if (title && title.length > 3) {
        jobElements.push({
          id: index + 1,
          title: title,
          location: location,
          url: jobUrl || window.location.href
        });
      }
    });

    return jobElements;
  });

  return jobs;
}

/**
 * Main scraper function with Puppeteer
 */
async function scrapeWithPuppeteer(url) {
  let browser;
  
  try {
    console.log('Launching browser for:', url);
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log('Navigating to page...');
    
    // Navigate to the page
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    // Wait for initial page load
    await sleep(3000);

    let jobs;

    // Check if it's a Workday site and use specific scraper
    if (isWorkday(url)) {
      console.log('Detected Workday site, using specialized scraper');
      jobs = await scrapeWorkday(page);
    } else {
      console.log('Using generic scraper');
      jobs = await scrapeGeneric(page);
    }

    await browser.close();

    if (jobs.length === 0) {
      return {
        success: false,
        error: 'No job listings found. The page may require interaction or have a different structure.'
      };
    }

    console.log(`Successfully extracted ${jobs.length} jobs`);

    return {
      success: true,
      jobs: jobs
    };

  } catch (error) {
    console.error('Scraping error:', error.message);
    
    if (browser) {
      await browser.close();
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { scrapeWithPuppeteer };
