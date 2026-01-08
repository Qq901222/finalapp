import express from 'express';
import { getExchange } from '../controllers/exchangeController';

const exchangeRoute = express.Router();
exchangeRoute.get('/', getExchange);

export default exchangeRoute;
