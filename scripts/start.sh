#!/bin/bash

echo "🚀 Starting Balance Manager..."

# Run database migrations
echo "📄 Running database migrations..."
npx prisma db push --accept-data-loss

# Start the application
echo "🎯 Starting Node.js application..."
node dist/index.js