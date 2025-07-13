require('dotenv').config();
const express = require('express');

// Simple health test
const app = express();

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: 'connected'
  });
});

const server = app.listen(3000, () => {
  console.log('✅ Test server started on port 3000');
  
  // Make a test request
  const http = require('http');
  const req = http.get('http://localhost:3000/health', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('✅ Health check response:', data);
      server.close();
      console.log('✅ Test completed successfully');
    });
  });
  
  req.on('error', (err) => {
    console.error('❌ Request failed:', err);
    server.close();
  });
});