// Crypto polyfill — must be FIRST (native module registers getRandomValues)
require('react-native-get-random-values');

// Polyfill Buffer BEFORE anything else loads
global.Buffer = require('buffer').Buffer;

// Base64 polyfill needed by Mobile Wallet Adapter
global.base64ToArrayBuffer = (base64) => {
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

// structuredClone polyfill needed by @solana/web3.js
global.structuredClone = global.structuredClone || ((obj) => JSON.parse(JSON.stringify(obj)));

// Now load the app
require('expo/AppEntry');
