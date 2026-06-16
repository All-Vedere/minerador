
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { term, asin } = req.query;

  try {
    if (asin) {
      // Fetch Amazon product page by ASIN
      const url = `https://www.amazon.com.br/dp/${asin}?language=pt_BR`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
        }
      });

      const html = await response.text();

      // Extract rating
      let rating = null;
      const ratingPatterns = [
        /(\d[,.]\d)\s*de\s*5\s*estrelas/i,
        /"ratingScore"[^>]*>\s*(\d[,.]\d)/i,
        /class="a-icon-alt"[^>]*>\s*(\d[,.]\d)/i,
        /averageStarRating["\s>]+(\d[,.]\d)/i,
      ];
      for (const p of ratingPatterns) {
        const m = html.match(p);
        if (m) { rating = parseFloat(m[1].replace(',', '.')); break; }
      }

      // Extract review count
      let reviewCount = null;
      const reviewPatterns = [
        /([\d.,]+)\s*avalia[çc][õo]es/i,
        /id="acrCustomerReviewText"[^>]*>\s*([\d.,]+)/i,
        /"reviewCount"\s*:\s*"?([\d]+)/i,
      ];
      for (const p of reviewPatterns) {
        const m = html.match(p);
        if (m) { reviewCount = parseInt(m[1].replace(/[.,]/g, '')); break; }
      }

      // Extract BSR
      let bsr = null;
      const bsrPatterns = [
        /#([\d.,]+)\s*(?:em|in)\s*[\w\s]+(?:Produtos|Products)/i,
        /salesrank[^>]*>\s*#?([\d.,]+)/i,
        /Best\s*Sellers?\s*Rank[^#]*#([\d.,]+)/i,
        /"bestSellerRank"\s*:\s*"?([\d]+)/i,
      ];
      for (const p of bsrPatterns) {
        const m = html.match(p);
        if (m) { bsr = parseInt(m[1].replace(/[.,]/g, '')); break; }
      }

      // Extract price
      let price = null;
      const pricePatterns = [
        /class="a-price-whole"[^>]*>\s*([\d.,]+)/i,
        /"price"\s*:\s*"R\$\s*([\d.,]+)"/i,
        /R\$\s*([\d]+[.,][\d]{2})/,
      ];
      for (const p of pricePatterns) {
        const m = html.match(p);
        if (m) { price = m[1].trim(); break; }
      }

      return res.status(200).json({ asin, rating, reviewCount, bsr, price, found: !!(rating || bsr) });

    } else if (term) {
      // Search Amazon.com.br for products
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(term)}&language=pt_BR`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9',
          'Cache-Control': 'no-cache',
        }
      });

      const html = await response.text();

      // Extract ASINs from search results
      const asinPattern = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/g;
      const asins = new Set();
      let m;
      while ((m = asinPattern.exec(html)) !== null) {
        asins.add(m[1]);
        if (asins.size >= 5) break;
      }

      return res.status(200).json({ asins: [...asins] });
    }

    return res.status(400).json({ error: 'Missing term or asin parameter' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
