export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { term, asin } = req.query;

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
  };

  try {
    if (asin) {
      const url = `https://www.amazon.com.br/dp/${asin}?language=pt_BR&th=1&psc=1`;
      const response = await fetch(url, { headers: HEADERS });
      const html = await response.text();

      // Rating
      let rating = null;
      const ratingPatterns = [
        /(\d[,.]\d)\s*de\s*5\s*estrelas/i,
        /"ratingScore"[^>]*>\s*(\d[,.]\d)/i,
        /class="a-icon-alt"[^>]*>\s*(\d[,.]\d)\s*de\s*5/i,
        /averageStarRating[^>]*>\s*(\d[,.]\d)/i,
        /"averageStarRating"\s*:\s*{\s*"displayValue"\s*:\s*"(\d[,.]\d)/i,
        /pdp_rating_count_[^>]*>[\s\S]*?(\d[,.]\d)\s*de/i,
      ];
      for (const p of ratingPatterns) {
        const m = html.match(p);
        if (m) { rating = parseFloat(m[1].replace(',', '.')); break; }
      }

      // Review count
      let reviewCount = null;
      const reviewPatterns = [
        /id="acrCustomerReviewText"[^>]*>\s*([\d.,]+)\s*avalia/i,
        /([\d.,]+)\s*avalia[çc][õo]es\s*de\s*clientes/i,
        /([\d.,]+)\s*classifica[çc][õo]es/i,
        /"reviewCount"\s*:\s*"?([\d]+)/i,
        /totalReviewCount[^>]*>\s*([\d.,]+)/i,
      ];
      for (const p of reviewPatterns) {
        const m = html.match(p);
        if (m) { reviewCount = parseInt(m[1].replace(/[.,]/g, '')); break; }
      }

      // BSR - multiple patterns
      let bsr = null;
      const bsrPatterns = [
        /#([\d.,]+)\s*(?:em|in)\s*(?:[\w\sÀ-ú]+)?(?:Produtos|Products|Eletr|Eletrodom|Cozinha|Beleza|Brinquedo|Esporte|Ferr|Inform|Livros|Moda|Pet)/i,
        /salesRank[^>]*rank[^>]*>([\d.,]+)/i,
        /Best\s*Sellers?\s*Rank[^#<]*#\s*([\d.,]+)/i,
        /"bestSellerRank"\s*[:\s]+"?([\d]+)/i,
        /rank_display[^>]*>\s*#?([\d.,]+)/i,
        /isBestSeller[^>]*>\s*#?([\d.,]+)/i,
        /<span[^>]*>.*?#([\d.,]+).*?(?:em|in)\s+\d+\s+(?:categoria|categor)/i,
        /bestsellers-rank[^>]*>[\s\S]*?#([\d.,]+)/i,
      ];
      for (const p of bsrPatterns) {
        const m = html.match(p);
        if (m) {
          const val = parseInt(m[1].replace(/[.,]/g, ''));
          if (val > 0 && val < 10000000) { bsr = val; break; }
        }
      }

      // Price
      let price = null;
      const pricePatterns = [
        /class="a-price-whole"[^>]*>\s*([\d.]+)/i,
        /"price"\s*:\s*"R\$\s*([\d.,]+)"/i,
        /priceblock_ourprice[^>]*>\s*R\$\s*([\d.,]+)/i,
        /R\$\s*<\/span>\s*([\d]+[.,][\d]{2})/i,
      ];
      for (const p of pricePatterns) {
        const m = html.match(p);
        if (m) { price = 'R$ ' + m[1].trim(); break; }
      }

      return res.status(200).json({ asin, rating, reviewCount, bsr, price, found: !!(rating || bsr) });

    } else if (term) {
      const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(term)}&language=pt_BR`;
      const response = await fetch(url, { headers: HEADERS });
      const html = await response.text();

      const asinPattern = /data-asin="([A-Z0-9]{10})"/g;
      const asins = new Set();
      let m;
      while ((m = asinPattern.exec(html)) !== null) {
        if (m[1] !== '0000000000') asins.add(m[1]);
        if (asins.size >= 8) break;
      }

      // Fallback pattern
      if (asins.size === 0) {
        const pat2 = /\/dp\/([A-Z0-9]{10})/g;
        while ((m = pat2.exec(html)) !== null) {
          asins.add(m[1]);
          if (asins.size >= 8) break;
        }
      }

      return res.status(200).json({ asins: [...asins], total: asins.size });
    }

    return res.status(400).json({ error: 'Missing term or asin parameter' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
