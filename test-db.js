require('dotenv').config();
const { Client } = require('pg');

async function testConnection() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: false
  });

  try {
    console.log('Attempting to connect to database...');
    console.log('Connection string:', process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
    
    await client.connect();
    console.log('Successfully connected to PostgreSQL database!');
    
    const result = await client.query('SELECT version()');
    console.log('PostgreSQL version:', result.rows[0].version);
    
    await client.end();
    console.log('Connection closed.');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    console.error('Full error:', error);
  }
}

testConnection();