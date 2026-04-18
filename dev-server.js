import express from 'express';
import apiRouter from './src/server/api.js';

const app = express();
app.use('/api', apiRouter);

const PORT = parseInt(process.env.API_PORT || '36001', 10);
app.listen(PORT, () => console.log(`[dev-api] listening on ${PORT}`));
