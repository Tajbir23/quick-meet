const path = require('path');
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://test:test@cluster0.sdyx3bs.mongodb.net/quickmeet?appName=Cluster0';
const db = require('./server/config/db');
const Channel = require('./server/models/Channel');
require('./server/models/User');
const http = require('http');

(async () => {
  await db();
  
  // Test 1: Virtual works correctly
  const channels = await Channel.find({ isActive: true })
    .populate('members.user', 'username avatar isOnline')
    .populate('owner', 'username avatar');
  
  console.log('=== DB Test ===');
  channels.forEach(ch => {
    const json = JSON.parse(JSON.stringify(ch));
    console.log(`"${ch.name}" -> subscriberCount: ${json.subscriberCount}, members: ${json.members?.length}`);
  });
  
  // Test 2: Actual API response via localhost
  console.log('\n=== API Test ===');
  const User = require('./server/models/User');
  const jwt = require(path.join(__dirname, 'server', 'node_modules', 'jsonwebtoken'));
  // Read JWT secret from .env
  const fs = require('fs');
  const envContent = fs.readFileSync(path.join(__dirname, 'server', '.env'), 'utf8');
  const jwtSecret = envContent.match(/JWT_SECRET=(.+)/)[1].trim();
  
  const user = await User.findOne({});
  const token = jwt.sign({ id: user._id }, jwtSecret, { expiresIn: '1h' });
  
  const https = require('https');
  
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/channels',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` },
    rejectUnauthorized: false,
  };
  
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (parsed.data?.channels) {
          parsed.data.channels.forEach(ch => {
            console.log(`API "${ch.name}" -> subscriberCount: ${ch.subscriberCount}, members: ${ch.members?.length}, has subscriberCount key: ${'subscriberCount' in ch}`);
          });
        } else {
          console.log('API response:', data.substring(0, 500));
        }
      } catch(e) {
        console.log('Parse error:', e.message, 'Response:', data.substring(0, 300));
      }
      process.exit(0);
    });
  });
  req.on('error', e => { console.log('Request error:', e.message); process.exit(1); });
  req.end();
})();
