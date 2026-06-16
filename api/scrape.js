export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url, page } = req.query;

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Cache-Control': 'no-cache',
  };

  try {
    // ─── ACTION: GET CATEGORIES ───
    if (action === 'categories') {
      const baseUrl = url.replace(/\/$/, '');
      const resp = await fetch(baseUrl, { headers: HEADERS });
      const html = await resp.text();

      // Extract category URLs from navigation menu
      const categories = [];
      const seen = new Set();

      // Pattern 1: WooCommerce category links
      const catPattern = /href="(https?:\/\/[^"]*\/categoria\/[^"]+)"/g;
      let m;
      while ((m = catPattern.exec(html)) !== null) {
        const catUrl = m[1].replace(/\/$/, '');
        if (!seen.has(catUrl)) {
          seen.add(catUrl);
          // Extract category name from URL slug
          const slug = catUrl.split('/categoria/')[1]?.split('/')[0] || '';
          const subSlug = catUrl.split('/categoria/')[1]?.split('/')[1] || '';
          const name = formatSlug(subSlug || slug);
          const isSubcategory = catUrl.split('/categoria/')[1]?.includes('/');
          categories.push({ url: catUrl + '/', name, isSubcategory, slug: subSlug || slug });
        }
      }

      // Pattern 2: Generic product category links
      if (categories.length === 0) {
        const genericPattern = /href="([^"]*\/(?:category|categoria|departamento|secao)[^"]+)"/gi;
        while ((m = genericPattern.exec(html)) !== null) {
          const catUrl = m[1].startsWith('http') ? m[1] : baseUrl + m[1];
          if (!seen.has(catUrl)) {
            seen.add(catUrl);
            const parts = catUrl.split('/');
            const name = formatSlug(parts[parts.length - 1] || parts[parts.length - 2]);
            categories.push({ url: catUrl, name, isSubcategory: false });
          }
        }
      }

      // Try to get product count for each main category
      const mainCategories = categories.filter(c => !c.isSubcategory).slice(0, 20);
      
      return res.status(200).json({ 
        categories: mainCategories,
        allCategories: categories,
        total: categories.length,
        baseUrl
      });
    }

    // ─── ACTION: GET PRODUCTS FROM CATEGORY ───
    if (action === 'products') {
      const pageNum = parseInt(page) || 1;
      const pageUrl = pageNum > 1 ? `${url}page/${pageNum}/` : url;
      
      const resp = await fetch(pageUrl, { headers: HEADERS });
      if (!resp.ok) return res.status(200).json({ products: [], hasNextPage: false });
      const html = await resp.text();

      const products = [];
      const seen = new Set();

      // WooCommerce product cards - multiple patterns
      // Pattern 1: Standard WooCommerce li.product
      const productBlocks = html.split(/<li[^>]*class="[^"]*product[^"]*"/i);
      
      for (let i = 1; i < productBlocks.length; i++) {
        const block = productBlocks[i];
        
        // Extract product URL
        const urlMatch = block.match(/href="([^"]+)"/);
        if (!urlMatch) continue;
        const productUrl = urlMatch[1];
        if (seen.has(productUrl)) continue;
        seen.add(productUrl);

        // Extract product name
        const nameMatch = block.match(/class="[^"]*woocommerce-loop-product__title[^"]*"[^>]*>([^<]+)</i) ||
                          block.match(/<h2[^>]*>([^<]+)</i) ||
                          block.match(/<h3[^>]*>([^<]+)</i);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (!name) continue;

        // Extract image
        const imgMatch = block.match(/data-src="([^"]+)"/i) ||
                         block.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/) ;
        const image = imgMatch ? imgMatch[1] : null;

        // Extract price
        const priceMatch = block.match(/R\$\s*([\d.,]+)/i) ||
                           block.match(/<span[^>]*class="[^"]*price[^"]*"[^>]*>([^<]+)</i);
        const price = priceMatch ? priceMatch[1].replace(/[^\d,]/g, '') : null;

        if (name && productUrl) {
          products.push({ name, url: productUrl, image, price });
        }
      }

      // Pattern 2: Article tags (some themes)
      if (products.length === 0) {
        const articlePattern = /<article[^>]*>([\s\S]*?)<\/article>/gi;
        let artMatch;
        while ((artMatch = articlePattern.exec(html)) !== null) {
          const block = artMatch[1];
          const urlMatch = block.match(/href="([^"]+)"/);
          const nameMatch = block.match(/<h\d[^>]*>([^<]+)<\/h\d>/i);
          const imgMatch = block.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
          const priceMatch = block.match(/R\$\s*([\d.,]+)/i);

          if (urlMatch && nameMatch) {
            const productUrl = urlMatch[1];
            if (!seen.has(productUrl)) {
              seen.add(productUrl);
              products.push({
                name: nameMatch[1].trim(),
                url: productUrl,
                image: imgMatch ? imgMatch[1] : null,
                price: priceMatch ? priceMatch[1] : null
              });
            }
          }
        }
      }

      // Check for next page
      const hasNextPage = html.includes('class="next') || 
                          html.includes('rel="next"') ||
                          html.includes(`page/${pageNum + 1}/`);

      // Get total product count if available
      const totalMatch = html.match(/(\d+)\s*(?:produto|result|item)/i);
      const totalProducts = totalMatch ? parseInt(totalMatch[1]) : null;

      return res.status(200).json({ 
        products: products.slice(0, 100),
        hasNextPage,
        pageNum,
        totalProducts
      });
    }

    return res.status(400).json({ error: 'Invalid action' });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function formatSlug(slug) {
  if (!slug) return 'Categoria';
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace('E ', 'e ')
    .replace('De ', 'de ')
    .replace('Para ', 'para ')
    .trim();
}
