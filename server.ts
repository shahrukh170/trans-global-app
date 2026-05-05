import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import fs from 'fs';
import csv from 'csv-parser';
import { fileURLToPath } from 'url';
import express from "express";
import Stripe from "stripe";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCES = [
  'utopya', 'amazon', 'priceoye', 'cjdropship', 'aliexpress', 'ebay', 'daraz', 
  'wefix', 'ifixit', 'pcbd', 'save'
];

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY||'pk_test_6pRNASCoBOKtIshFeQd4XMUh');  // API Routes
  
  app.post("/api/create-subscription", async (req, res) => {
	const { userId, email } = req.body;
	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		payment_method_types: ["card"],
		customer_email: email,
		line_items: [
		  {
			price: "PRICE_ID_HERE", // your €29 plan
			quantity: 1,
		  },
		],
		success_url: `https://yourdomain.com/success?user=${userId}`,
		cancel_url: `https://yourdomain.com/cancel`,
	  });

	  res.json({ url: session.url });
	});
  
  app.get('/api/data', async (req, res) => {
    const results: any[] = [];

    for (const source of SOURCES) {
      // Look in src/outputs/[source]/cleaned_database.csv as requested
      const filePath = path.join(process.cwd(), 'src', 'outputs', source, 'cleaned_database.csv');
      
      if (fs.existsSync(filePath)) {
        const fileRows: any[] = [];
        try {
          await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
              .pipe(csv())
              .on('data', (data) => fileRows.push({ ...data, _source: source }))
              .on('end', resolve)
              .on('error', reject);
          });
          results.push(...fileRows);
        } catch (err) {
          console.error(`Error reading ${source}:`, err);
        }
      } else {
        // Fallback for current demo data directory if src/outputs doesn't exist yet
        const fallbackPath = path.join(process.cwd(), 'data', `${source}.csv`);
        if (fs.existsSync(fallbackPath)) {
          const fileRows: any[] = [];
          await new Promise((resolve, reject) => {
            fs.createReadStream(fallbackPath)
              .pipe(csv())
              .on('data', (data) => fileRows.push({ ...data, _source: source }))
              .on('end', resolve)
              .on('error', reject);
          });
          results.push(...fileRows);
        }
      }
    }

    res.json(results);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
