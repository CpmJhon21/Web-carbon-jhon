require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createClient } = require('redis');
const { body, validationResult } = require('express-validator');

// Import Puppeteer dengan error handling
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (error) {
  console.warn('Puppeteer not available, using fallback mode');
}

class CarbonGenerator {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.redisClient = null;
    this.browser = null;
    this.isBrowserReady = false;
    
    this.initMiddleware();
    this.initRoutes();
    this.initErrorHandling();
    this.initRedis();
    this.initBrowser();
  }

  async initRedis() {
    if (process.env.REDIS_URL) {
      try {
        this.redisClient = createClient({
          url: process.env.REDIS_URL,
          password: process.env.REDIS_PASSWORD
        });
        
        this.redisClient.on('error', (err) => {
          console.error('Redis Client Error', err);
        });
        
        await this.redisClient.connect();
        console.log('✅ Redis connected successfully');
      } catch (error) {
        console.warn('⚠️ Redis connection failed, using memory cache');
      }
    }
  }

  async initBrowser() {
    if (!puppeteer) {
      console.warn('⚠️ Puppeteer not available, running in API-only mode');
      return;
    }

    try {
      const launchOptions = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=site-per-process',
          '--disable-setuid-sandbox',
          '--disable-accelerated-2d-canvas',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-component-extensions-with-background-pages',
          '--disable-extensions',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-renderer-backgrounding',
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--font-render-hinting=none'
        ],
        defaultViewport: {
          width: 1200,
          height: 800,
          deviceScaleFactor: 2
        }
      };

      // Set executable path jika ada di env
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      this.browser = await puppeteer.launch(launchOptions);
      this.isBrowserReady = true;
      console.log('✅ Browser instance ready');
    } catch (error) {
      console.error('❌ Failed to launch browser:', error.message);
      this.isBrowserReady = false;
    }
  }

  initMiddleware() {
    // Security headers
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:"],
          scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"]
        }
      }
    }));

    // CORS configuration
    const corsOptions = {
      origin: process.env.CORS_ORIGIN 
        ? process.env.CORS_ORIGIN.split(',') 
        : ['http://localhost:3000', 'http://localhost:5500'],
      credentials: true,
      optionsSuccessStatus: 200
    };
    this.app.use(cors(corsOptions));

    // Rate limiting
    const apiLimiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
      message: {
        error: 'Too many requests from this IP, please try again later.'
      },
      standardHeaders: true,
      legacyHeaders: false
    });

    // Apply rate limiting to API routes
    this.app.use('/api/', apiLimiter);

    // Body parsing and compression
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(compression());

    // Logging
    if (process.env.NODE_ENV !== 'production') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined'));
    }

    // Static files
    this.app.use(express.static(path.join(__dirname, '../frontend')));
  }

  generateHTMLTemplate(code, options = {}) {
    const {
      theme = 'dark',
      backgroundColor = '#262424',
      fontFamily = 'Fira Code',
      fontSize = '14px',
      language = 'auto',
      showLineNumbers = true,
      showWindowControls = true,
      padding = '40px',
      lineHeight = '1.6',
      tabSize = 2
    } = options;

    const themes = {
      dark: {
        background: '#262424',
        text: '#f8f8f2',
        comment: '#6272a4',
        keyword: '#ff79c6',
        string: '#f1fa8c',
        number: '#bd93f9',
        function: '#50fa7b',
        class: '#8be9fd',
        variable: '#ffb86c',
        operator: '#ff79c6'
      },
      light: {
        background: '#ffffff',
        text: '#383a42',
        comment: '#a0a1a7',
        keyword: '#a626a4',
        string: '#50a14f',
        number: '#986801',
        function: '#4078f2',
        class: '#c18401',
        variable: '#e45649',
        operator: '#a626a4'
      },
      solarized: {
        background: '#002b36',
        text: '#839496',
        comment: '#586e75',
        keyword: '#859900',
        string: '#2aa198',
        number: '#d33682',
        function: '#b58900',
        class: '#268bd2',
        variable: '#cb4b16',
        operator: '#859900'
      }
    };

    const themeColors = themes[theme] || themes.dark;
    const fontFamilyCSS = fontFamily.includes(' ') ? `'${fontFamily}'` : fontFamily;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Carbon Code</title>
    <link href="https://fonts.googleapis.com/css2?family=${fontFamily.replace(/ /g, '+')}&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: ${backgroundColor};
            font-family: ${fontFamilyCSS}, monospace;
            font-size: ${fontSize};
            line-height: ${lineHeight};
            color: ${themeColors.text};
            padding: ${padding};
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .carbon-container {
            width: 100%;
            max-width: 900px;
            background: ${theme === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)'};
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            border: 1px solid ${theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
        }
        
        ${showWindowControls ? `
        .window-header {
            background: ${theme === 'dark' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.1)'};
            padding: 16px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 1px solid ${theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
        }
        
        .window-controls {
            display: flex;
            gap: 10px;
        }
        
        .window-dot {
            width: 14px;
            height: 14px;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .window-dot:hover {
            transform: scale(1.1);
        }
        
        .dot-close { background: #ff5f56; }
        .dot-minimize { background: #ffbd2e; }
        .dot-maximize { background: #27ca3f; }
        
        .window-title {
            font-size: 0.9em;
            color: ${themeColors.comment};
            font-weight: 500;
        }
        ` : ''}
        
        .code-wrapper {
            padding: 32px;
            overflow: auto;
        }
        
        pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
            tab-size: ${tabSize};
        }
        
        code {
            font-family: inherit;
            display: block;
        }
        
        .line {
            display: flex;
            min-height: ${parseInt(fontSize) * parseFloat(lineHeight)}px;
        }
        
        ${showLineNumbers ? `
        .line-number {
            color: ${themeColors.comment};
            user-select: none;
            text-align: right;
            min-width: 40px;
            padding-right: 16px;
            border-right: 1px solid ${theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'};
            margin-right: 16px;
        }
        ` : ''}
        
        .token.comment { color: ${themeColors.comment}; font-style: italic; }
        .token.keyword { color: ${themeColors.keyword}; font-weight: 600; }
        .token.string { color: ${themeColors.string}; }
        .token.number { color: ${themeColors.number}; }
        .token.function { color: ${themeColors.function}; }
        .token.class { color: ${themeColors.class}; }
        .token.variable { color: ${themeColors.variable}; }
        .token.operator { color: ${themeColors.operator}; }
        .token.punctuation { color: ${themeColors.text}; opacity: 0.8; }
        
        .grid-bg {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-image: 
                linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
            background-size: 30px 30px;
            pointer-events: none;
            z-index: 0;
        }
        
        .content {
            position: relative;
            z-index: 1;
        }
    </style>
</head>
<body>
    <div class="carbon-container">
        ${showWindowControls ? `
        <div class="window-header">
            <div class="window-controls">
                <div class="window-dot dot-close" title="Close"></div>
                <div class="window-dot dot-minimize" title="Minimize"></div>
                <div class="window-dot dot-maximize" title="Maximize"></div>
            </div>
            <div class="window-title">${language.toUpperCase()} • Carbon Generator</div>
            <div style="width: 60px;"></div>
        </div>
        ` : ''}
        
        <div class="code-wrapper">
            <div class="grid-bg"></div>
            <div class="content">
                <pre><code>${this.escapeHTML(code)}</code></pre>
            </div>
        </div>
    </div>
    
    <script>
        (function highlightSyntax() {
            const codeElement = document.querySelector('code');
            if (!codeElement) return;
            
            let code = codeElement.textContent;
            const lines = code.split('\\n');
            const language = '${language}';
            
            // Basic syntax highlighting patterns
            const patterns = {
                javascript: [
                    { regex: /\\/\\/.*$/gm, className: 'comment' },
                    { regex: /\\/\\*[\\s\\S]*?\\*\\//g, className: 'comment' },
                    { regex: /(["'`])(?:\\\\.|[^\\\\])*?\\1/g, className: 'string' },
                    { regex: /\\b(\\d+\\.?\\d*|0x[\\da-fA-F]+)\\b/g, className: 'number' },
                    { regex: /\\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|extends|import|export|default|async|await|try|catch|finally|throw|new|this|super)\\b/g, className: 'keyword' },
                    { regex: /\\b(console|Math|Date|String|Number|Array|Object|Promise|JSON)\\b/g, className: 'class' },
                    { regex: /(=|\\+|\\-|\\*|\\/|%|==|===|!=|!==|>|<|>=|<=|&&|\\|\\||!|\\?:|\\.\\.\\.)\\b/g, className: 'operator' },
                    { regex: /([{}()\\[\\];:,])/g, className: 'punctuation' }
                ],
                python: [
                    { regex: /#.*$/gm, className: 'comment' },
                    { regex: /(["'"])(?:\\\\.|[^\\\\])*?\\1/g, className: 'string' },
                    { regex: /\\b(\\d+\\.?\\d*)\\b/g, className: 'number' },
                    { regex: /\\b(def|class|return|if|elif|else|for|while|try|except|finally|with|import|from|as|lambda|pass|break|continue|raise|yield|async|await)\\b/g, className: 'keyword' },
                    { regex: /\\b(print|len|range|str|int|float|list|dict|tuple|set|True|False|None)\\b/g, className: 'class' }
                ],
                html: [
                    { regex: /&lt;!--[\\s\\S]*?--&gt;/g, className: 'comment' },
                    { regex: /&lt;\\/?[a-zA-Z][^&lt;&gt;]*&gt;/g, className: 'keyword' },
                    { regex: /(["'])(?:\\\\.|[^\\\\])*?\\1/g, className: 'string' }
                ],
                css: [
                    { regex: /\\/\\*[\\s\\S]*?\\*\\//g, className: 'comment' },
                    { regex: /(["'])(?:\\\\.|[^\\\\])*?\\1/g, className: 'string' },
                    { regex: /\\b(\\d+)(px|em|rem|%|s|ms)?\\b/g, className: 'number' },
                    { regex: /\\b(@media|@import|@keyframes|@font-face|@page)\\b/g, className: 'keyword' }
                ]
            };
            
            const langPatterns = patterns[language] || patterns.javascript;
            
            langPatterns.forEach(({ regex, className }) => {
                code = code.replace(regex, '<span class="token ' + className + '">$&</span>');
            });
            
            // Add line numbers
            if (${showLineNumbers}) {
                let numberedCode = '';
                lines.forEach((line, i) => {
                    const lineNumber = i + 1;
                    const lineContent = line || ' ';
                    numberedCode += '<div class="line">';
                    numberedCode += '<span class="line-number">' + lineNumber + '</span>';
                    numberedCode += '<span class="line-content">' + lineContent + '</span>';
                    numberedCode += '</div>';
                });
                code = numberedCode;
            }
            
            codeElement.innerHTML = code;
        })();
    </script>
</body>
</html>`;
  }

  escapeHTML(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/\n/g, '<br>')
      .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
      .replace(/ /g, '&nbsp;');
  }

  async getFromCache(key) {
    if (!this.redisClient) return null;
    
    try {
      const cached = await this.redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }

  async setToCache(key, value, ttl = 3600) {
    if (!this.redisClient) return false;
    
    try {
      await this.redisClient.set(key, JSON.stringify(value), {
        EX: ttl
      });
      return true;
    } catch (error) {
      console.error('Cache write error:', error);
      return false;
    }
  }

  initRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'carbon-generator',
        version: '1.0.0',
        browser: this.isBrowserReady ? 'ready' : 'not-ready',
        cache: this.redisClient ? 'connected' : 'disabled'
      });
    });

    // Stats endpoint
    this.app.get('/api/stats', (req, res) => {
      res.json({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        browser: this.isBrowserReady,
        cache: !!this.redisClient,
        timestamp: new Date().toISOString()
      });
    });

    // Generate endpoint with validation
    this.app.post('/api/generate', 
      [
        body('code')
          .notEmpty().withMessage('Code is required')
          .isString().withMessage('Code must be a string')
          .isLength({ max: 10000 }).withMessage('Code too long (max 10000 chars)'),
        body('options.theme')
          .optional()
          .isIn(['dark', 'light', 'solarized']).withMessage('Invalid theme'),
        body('options.fontSize')
          .optional()
          .matches(/^\d+(px|em|rem)$/).withMessage('Invalid font size format'),
        body('options.padding')
          .optional()
          .matches(/^\d+(px|em|rem)$/).withMessage('Invalid padding format')
      ],
      async (req, res) => {
        try {
          // Validate input
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({
              success: false,
              errors: errors.array()
            });
          }

          const { code, options = {} } = req.body;
          
          // Generate cache key
          const cacheKey = `carbon:${Buffer.from(code).toString('base64')}:${JSON.stringify(options)}`;
          
          // Check cache first
          const cached = await this.getFromCache(cacheKey);
          if (cached) {
            return res.json({
              ...cached,
              cached: true,
              timestamp: new Date().toISOString()
            });
          }

          // Validate browser availability
          if (!this.isBrowserReady || !this.browser) {
            return res.status(503).json({
              success: false,
              error: 'Image generation service is temporarily unavailable',
              fallback: true
            });
          }

          console.log(`Generating image for code (${code.length} chars)`);

          let page;
          try {
            page = await this.browser.newPage();
            
            // Set content with timeout
            const html = this.generateHTMLTemplate(code, options);
            await page.setContent(html, { 
              waitUntil: ['networkidle0', 'domcontentloaded'],
              timeout: 10000 
            });

            // Wait for rendering
            await page.waitForFunction(
              () => document.readyState === 'complete',
              { timeout: 5000 }
            );

            // Get element dimensions
            const dimensions = await page.evaluate(() => {
              const element = document.querySelector('.carbon-container');
              if (!element) return null;
              const rect = element.getBoundingClientRect();
              return {
                x: Math.floor(rect.x),
                y: Math.floor(rect.y),
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height)
              };
            });

            if (!dimensions) {
              throw new Error('Could not find code container');
            }

            // Take screenshot
            const screenshot = await page.screenshot({
              type: 'png',
              encoding: 'base64',
              clip: {
                x: dimensions.x,
                y: dimensions.y,
                width: Math.min(dimensions.width, 1920),
                height: Math.min(dimensions.height, 1080)
              },
              omitBackground: false,
              quality: 100
            });

            await page.close();

            // Prepare response
            const result = {
              success: true,
              image: `data:image/png;base64,${screenshot}`,
              dimensions: {
                width: dimensions.width,
                height: dimensions.height
              },
              cached: false,
              timestamp: new Date().toISOString()
            };

            // Cache result
            await this.setToCache(cacheKey, result);

            res.json(result);

          } catch (pageError) {
            if (page) await page.close().catch(() => {});
            throw pageError;
          }

        } catch (error) {
          console.error('Generation error:', error);
          
          res.status(500).json({
            success: false,
            error: 'Failed to generate image',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
          });
        }
      }
    );

    // Download endpoint
    this.app.get('/api/download', async (req, res) => {
      try {
        const { url, filename = 'carbon-code.png' } = req.query;
        
        if (!url || !url.startsWith('data:image/png;base64,')) {
          return res.status(400).json({
            success: false,
            error: 'Invalid image URL'
          });
        }

        const base64Data = url.split(',')[1];
        if (!base64Data) {
          return res.status(400).json({
            success: false,
            error: 'Invalid base64 data'
          });
        }

        const buffer = Buffer.from(base64Data, 'base64');
        
        // Validate it's actually an image
        if (buffer.length < 8) {
          return res.status(400).json({
            success: false,
            error: 'Invalid image data'
          });
        }

        // Set headers
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'no-store');
        
        res.send(buffer);

      } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
          success: false,
          error: 'Download failed'
        });
      }
    });

    // Fallback endpoint (without Puppeteer)
    this.app.post('/api/generate/fallback', (req, res) => {
      const { code } = req.body;
      
      if (!code) {
        return res.status(400).json({
          success: false,
          error: 'Code is required'
        });
      }

      // Return a simple JSON response with instructions
      res.json({
        success: true,
        message: 'Fallback mode active. Install Puppeteer for image generation.',
        codePreview: code.substring(0, 200) + (code.length > 200 ? '...' : ''),
        length: code.length,
        timestamp: new Date().toISOString()
      });
    });

    // Serve frontend
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../frontend/index.html'));
    });
  }

  initErrorHandling() {
    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      console.error('Unhandled error:', err);
      
      res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message,
        timestamp: new Date().toISOString()
      });
    });
  }

  async shutdown() {
    console.log('Shutting down gracefully...');
    
    if (this.browser) {
      await this.browser.close().catch(console.error);
    }
    
    if (this.redisClient) {
      await this.redisClient.quit().catch(console.error);
    }
    
    process.exit(0);
  }

  start() {
    const server = this.app.listen(this.port, () => {
      console.log(`
╔═══════════════════════════════════════════╗
║     🚀 Carbon Generator Server Started    ║
╠═══════════════════════════════════════════╣
║ Port:         ${this.port.toString().padEnd(30)} ║
║ Environment:  ${process.env.NODE_ENV || 'development'.padEnd(30)} ║
║ Browser:      ${this.isBrowserReady ? '✅ Ready'.padEnd(30) : '❌ Not Ready'.padEnd(30)} ║
║ Cache:        ${this.redisClient ? '✅ Redis'.padEnd(30) : '❌ Memory Only'.padEnd(30)} ║
║ Health:       http://localhost:${this.port}/api/health${' '.repeat(Math.max(0, 28 - this.port.toString().length))}║
╚═══════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());

    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error);
      this.shutdown();
    });
  }
}

// Start the server
const server = new CarbonGenerator();
server.start();