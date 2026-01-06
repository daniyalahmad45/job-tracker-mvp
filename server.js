const express = require('express');
const path = require('path');
const { fetchWithTimeout } = require('./utils/fetcher');
const { scrapeWithPuppeteer } = require('./utils/scraper');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Fetch job listings endpoint
app.post('/api/fetch-jobs', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL is required'
    });
  }

  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    // ============================================
    // GREENHOUSE SUPPORT (both boards.greenhouse.io and job-boards.greenhouse.io)
    // ============================================
    if (hostname.includes('greenhouse.io')) {
      let company;

      const forMatch = url.match(/[?&]for=([^&]+)/);
      if (forMatch) {
        company = forMatch[1];
      } else {
        const pathMatch = parsedUrl.pathname.match(/\/([^\/]+)/);
        if (pathMatch && pathMatch[1] && pathMatch[1] !== 'embed') {
          company = pathMatch[1];
        }
      }

      if (!company) {
        return res.status(400).json({
          success: false,
          error: 'Unable to detect company name'
        });
      }

      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;
      console.log('Fetching from Greenhouse API:', apiUrl);
      
      const result = await fetchWithTimeout(apiUrl, 10000);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: `Failed to fetch jobs: ${result.error}. Company "${company}" may not have a public Greenhouse board.`
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(result.data);
      } catch (e) {
        return res.status(500).json({
          success: false,
          error: 'Failed to parse job data'
        });
      }

      const jobs = parsed.jobs || [];

      return res.json({
        success: true,
        jobCount: jobs.length,
        platform: 'Greenhouse',
        jobs: jobs.map(job => ({
          id: job.id,
          title: job.title,
          location: job.location?.name || 'Remote',
          url: job.absolute_url
        }))
      });
    }

    // ============================================
    // LEVER SUPPORT
    // ============================================
    if (hostname.includes('lever.co')) {
      const companyMatch = parsedUrl.pathname.match(/\/([^\/]+)/);
      
      if (!companyMatch || !companyMatch[1]) {
        return res.status(400).json({
          success: false,
          error: 'Unable to detect company name from Lever URL'
        });
      }

      const company = companyMatch[1];
      const apiUrl = `https://api.lever.co/v0/postings/${company}`;
      
      console.log('Fetching from Lever API:', apiUrl);
      
      const result = await fetchWithTimeout(apiUrl, 10000);

      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: `Failed to fetch jobs: ${result.error}`
        });
      }

      const jobs = JSON.parse(result.data);

      return res.json({
        success: true,
        jobCount: jobs.length,
        platform: 'Lever',
        jobs: jobs.map(job => ({
          id: job.id,
          title: job.text,
          location: job.categories?.location || 'Remote',
          url: job.hostedUrl
        }))
      });
    }

    // ============================================
    // GENERIC SCRAPER (for everything else)
    // ============================================
    console.log('Using Puppeteer scraper for:', url);
    
    const result = await scrapeWithPuppeteer(url);

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json({
      success: true,
      jobCount: result.jobs.length,
      platform: 'Generic Scraper',
      jobs: result.jobs
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

// ============================================
// AI ANALYSIS ENDPOINT (NEW!)
// ============================================
app.post('/api/analyze-jobs', async (req, res) => {
  const { jobs, profile, company } = req.body;

  if (!jobs || !jobs.length) {
    return res.status(400).json({
      success: false,
      error: 'Jobs array is required'
    });
  }

  try {
    const prompt = `You are a career advisor AI helping a job seeker find relevant positions.

Job Seeker Profile:
- Major/Field: ${profile.major || 'Not specified'}
- Experience Level: ${profile.level || 'Not specified'}
- Skills & Interests: ${profile.skills || 'Not specified'}

Jobs from ${company}:
${jobs.map((j, i) => `${i + 1}. ${j.title} - ${j.location}`).join('\n')}

Analyze EACH job and rate its relevance:
- "High" = Perfect match for their field, skills, and level
- "Medium" = Somewhat related or transferable skills
- "Low" = Not relevant to their background

Respond with ONLY a JSON array (no markdown, no explanations):
[
  {"index": 1, "relevance": "High", "reason": "One sentence why"},
  {"index": 2, "relevance": "Medium", "reason": "One sentence why"},
  ...
]`;

    console.log('Calling Claude API for job analysis...');

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Unexpected API response format');
    }

    const aiResponse = data.content[0].text;
    
    // Clean and parse JSON
    let cleanJson = aiResponse.trim();
    cleanJson = cleanJson.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const jsonMatch = cleanJson.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanJson = jsonMatch[0];
    }
    
    const analysis = JSON.parse(cleanJson);
    console.log(`AI analyzed ${analysis.length} jobs successfully`);

    return res.json({
      success: true,
      analysis: analysis
    });

  } catch (error) {
    console.error('AI analysis error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});