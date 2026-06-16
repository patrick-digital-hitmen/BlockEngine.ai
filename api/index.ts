import express from 'express';
import { apiRouter } from '../src/server/api.js';

const app = express();
app.use('/api', apiRouter);

export default app;
