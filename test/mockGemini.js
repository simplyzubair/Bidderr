// Fake Gemini API for the end-to-end test. Answers like Google and writes every job text it
// receives to MOCK_LOG, so the test can check what Bidderr sent. Usage: node test/mockGemini.js
const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.MOCK_PORT || 8787);
const LOG = process.env.MOCK_LOG || 'mock-requests.log';
const GOOD_KEY = 'test-key';

const PROPOSAL = [
  'Hello Sarah,',
  '',
  'I will redraw your logo as a clean vector, ready for print.',
  '',
  'Offer Summary:',
  '1. 100% Manual Careful Work No Auto Tools',
  '5. **Delivery Time: 6 hours**',
  '6. **Price: $40**',
  '',
  'Best,',
  'Khan',
].join('\n');

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const ok = req.headers['x-goog-api-key'] === GOOD_KEY;
      res.setHeader('Content-Type', 'application/json');
      if (!ok) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: 'API key not valid.' } }));
      }
      if (req.method === 'GET' && req.url.startsWith('/v1beta/models')) {
        return res.end(JSON.stringify({ models: [{ name: 'models/test' }] }));
      }
      if (req.method === 'POST' && /:(stream)?generateContent/i.test(req.url)) {
        const job = JSON.parse(body).contents[0].parts[0].text;
        fs.appendFileSync(LOG, `${JSON.stringify({ url: req.url, job })}\n`);
        const answer = { candidates: [{ content: { parts: [{ text: PROPOSAL }] } }] };
        if (!req.url.includes(':streamGenerateContent')) return res.end(JSON.stringify(answer));
        // Streamed answer, like Google's ?alt=sse.
        res.setHeader('Content-Type', 'text/event-stream');
        return res.end(`data: ${JSON.stringify(answer)}\n\n`);
      }
      res.statusCode = 404;
      res.end('{}');
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`mock gemini on ${PORT}`));
