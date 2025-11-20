// scripts/write-config.js
const fs = require('fs');
const path = require('path');

console.log('Starting to write Firebase config...');

// Vercel provides these environment variables
const config = {
    apiKey: process.env.PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.PUBLIC_FIREBASE_MEASUREMENT_ID
};

// Check if all keys are present
const missingKeys = Object.keys(config).filter(key => !config[key]);
if (missingKeys.length > 0) {
    console.warn(`Warning: Missing Vercel environment variables: ${missingKeys.join(', ')}`);
}

// Write the config to a file in the root directory
// Vercel serves the root directory by default for static projects
const outPath = path.join(__dirname, '..', 'firebase.config.js');
const content = `window.__FIREBASE_CONFIG__ = ${JSON.stringify(config, null, 2)};`;

try {
    fs.writeFileSync(outPath, content);
    console.log(`Successfully wrote firebase.config.js to ${outPath}`);
} catch (err) {
    console.error(`Failed to write config file: ${err.message}`);
    process.exit(1); // Exit with error
}