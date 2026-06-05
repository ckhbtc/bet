import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './src/server/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use('/api', apiRouter);

// No caching for index.html — ensures deploys are picked up immediately
app.use(express.static(join(__dirname, 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

const PORT = parseInt(process.env.PORT || '36000', 10);
app.listen(PORT, () => console.log(`YOLO running on port ${PORT}`));
