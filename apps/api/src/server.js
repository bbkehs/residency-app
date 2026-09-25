import mongoose from 'mongoose';
import { createApp } from './app.js';
import { initializeIndexes } from './models.js';
if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI in .env. See README.md.');
await mongoose.connect(process.env.MONGODB_URI);
await initializeIndexes();
const app = createApp();
const server = app.listen(Number(process.env.PORT || 4000), '0.0.0.0', () => console.log(`Residency API listening on port ${process.env.PORT || 4000}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await mongoose.disconnect(); process.exit(0); }));
