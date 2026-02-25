const pool = require('../config/db');
const {
  validatePrice,
  validateStockQuantity,
  validateSalePercent,
  validateSoldQuantity
} = require('../utils/validate');

exports.getProducts = async function ({
    limit = 40,
    order = 'asc',
    cursor,
    search_key,
    category_id,
    supplier_id,
    min_price,
    max_price,
    price_range,
    is_flash_sale,
    status,
    page,
    sort_by = 'sequence', // 'sequence' (default) or 'price'
    only_available = false // nếu true chỉ lấy sp còn hàng (ít nhất 1 variant có stock_qty > 0)
} = {}) {
    if (limit < 1 || limit > 100) throw new Error('Invalid limit (1-100)');
    if (!['asc', 'desc'].includes(order)) throw new Error('Invalid order (asc/desc)');
    if (page && page < 1) throw new Error('Invalid page');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let categoryIds = null;
        if (category_id) {
            const catRes = await client.query(
                `WITH RECURSIVE subcats AS (
                    SELECT id FROM categories WHERE id = $1
                    UNION ALL
                    SELECT c.id FROM categories c JOIN subcats s ON c.parent_id = s.id
                ) SELECT id FROM subcats`,
                [category_id]
            );
            categoryIds = catRes.rows.map(r => r.id);
            if (categoryIds.length === 0) categoryIds = [category_id];
        }

        const where = [];
        const params = [];
        let idx = 1;

        if (status) {
            where.push(`p.status = $${idx++}`);
            params.push(status);
        } else {
            where.push(`p.status = 'active'`);
        }

        if (search_key) {
            where.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx})`);
            params.push(`%${search_key}%`);
            idx++;
        }

        if (categoryIds) {
            where.push(`p.category_id = ANY($${idx}::uuid[])`);
            params.push(categoryIds);
            idx++;
        }

        if (supplier_id) {
            where.push(`p.supplier_id = $${idx++}`);
            params.push(supplier_id);
        }

        // parse price_range like "100000-200000" into min_price/max_price when neither min/max provided
        if ((!min_price && !max_price) && typeof price_range === 'string') {
            const m = price_range.trim().match(/^(\d+)\s*-\s*(\d+)$/);
            if (m) {
                min_price = Number(m[1]);
                max_price = Number(m[2]);
            }
        }
        // also support min_price passed as "100000-200000"
        if (typeof min_price === 'string' && min_price.includes('-') && (max_price === undefined || max_price === null)) {
            const m2 = String(min_price).trim().match(/^(\d+)\s*-\s*(\d+)$/);
            if (m2) {
                min_price = Number(m2[1]);
                max_price = Number(m2[2]);
            }
        }
        if (min_price !== undefined && min_price !== null) min_price = Number(min_price);
        if (max_price !== undefined && max_price !== null) max_price = Number(max_price);
        
        console.debug('[productService.getProducts] parsed price_range ->', { min_price, max_price, price_range });

        if (typeof min_price !== 'undefined') {
            where.push(`p.final_price >= $${idx++}`);
            params.push(Number(min_price));
        }

        if (typeof max_price !== 'undefined') {
            where.push(`p.final_price <= $${idx++}`);
            params.push(Number(max_price));
        }

        if (typeof is_flash_sale !== 'undefined') {
            where.push(`p.is_flash_sale = $${idx++}`);
            params.push(!!is_flash_sale);
        }

        if(only_available){
            where.push(`EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id AND pv.stock_qty > 0)`);
        }

        let sql = '';
        const limitPlus = Number(limit) + 1;
        const orderKey = (sort_by === 'price') ? 'p.final_price' : 'p.sequence_id';
        const orderBy = `${orderKey} ${order === 'desc' ? 'DESC' : 'ASC'}`;

        if (typeof cursor !== 'undefined' && cursor !== null) {
            const cmp = (order === 'asc') ? '>' : '<';
            where.push(`p.sequence_id ${cmp} $${idx++}`);
            params.push(Number(cursor));
            sql = `SELECT * FROM v_product_full p WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${idx++}`;
            params.push(limitPlus);
            
        } else if (page && Number.isFinite(Number(page))) {
            
            const pg = Math.max(1, Number(page));
            const offset = (pg - 1) * Number(limit);
            sql = `SELECT * FROM v_product_full p WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`;
            params.push(limitPlus);
            params.push(offset);
        } else {
          //kiểm tra xem trạng thái sản phẩm có active ko, nếu k có active thì không trả về sp
            //where.push(`p.status = 'active'`);
            sql = `SELECT * FROM v_product_full p WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${idx++}`;
            params.push(limitPlus);
        }

        const qRes = await client.query(sql, params);
        await client.query('COMMIT');

        const rows = qRes.rows || [];
        const hasMore = rows.length > Number(limit);
        const products = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor = null;
        if (products.length > 0) {
            const lastKey = (sort_by === 'price') ? 'final_price' : 'sequence_id';
            nextCursor = products[products.length - 1][lastKey] ?? null;
        }

        return {
            products,
            nextCursor,
            hasMore
        };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
};

exports.createProduct = async (productData) => {
  const {
    name, description, category_id, supplier_id,
    price, sale_percent = 0, is_flash_sale = false,
    images = [], variants = []
  } = productData;

  productData.price = validatePrice(price);
  productData.sale_percent = validateSalePercent(sale_percent);

  for(const v of variants){
    v.stock_qty = validateStockQuantity(v.stock_qty);

    if(v.sold_qty !== undefined){
      v.sold_qty = validateSoldQuantity(v.sold_qty);
    }
  }

  //validate: sp có ít nhất 1 ảnh
  if(!images || images.length === 0){
      const err = new Error('Product must have at least 1 image');
      err.statusCode = 400;
      throw err;
  }

  //validate: variant have at least 1 variant image
  for( const variant of variants){
      if(!variant.images || variant.images.length === 0){
        const err = new Error(`Variant ${variant.sku} must have at least 1 image`);
        err.statusCode = 400;
        throw err;
      }
  }

  // set to match DB (ensure you ALTER TABLE to same value)
  const MAX_SKU_LEN = 252;
  const MAX_COLOR_CODE_LEN = 32;

  // debug log before DB work
  console.log('createProduct - variants:', JSON.stringify(variants, null, 2));

  // Validate variant fields early and return clear message
  for (const v of variants) {
    if (!v.sku || typeof v.sku !== 'string') {
      const err = new Error('Each variant must have a SKU');
      err.statusCode = 400;
      throw err;
    }
    if (v.sku.length > MAX_SKU_LEN) {
      const err = new Error(`SKU "${v.sku}" is too long (length=${v.sku.length}, max=${MAX_SKU_LEN})`);
      err.statusCode = 400;
      throw err;
    }
    if (v.color_code && v.color_code.length > MAX_COLOR_CODE_LEN) {
      const err = new Error(`color_code "${v.color_code}" is too long (length=${v.color_code.length}, max=${MAX_COLOR_CODE_LEN})`);
      err.statusCode = 400;
      throw err;
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // === 1. VALIDATE category & supplier ===
    const cat = await client.query('SELECT id FROM categories WHERE id = $1', [category_id]);
    if (cat.rowCount === 0) throw new Error('Invalid category_id');

    const sup = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplier_id]);
    if (sup.rowCount === 0) throw new Error('Invalid supplier_id');

    // === 2. INSERT PRODUCT ===
    const productRes = await client.query(
      `INSERT INTO products 
       (name, description, category_id, supplier_id, price, sale_percent, is_flash_sale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [name, description, category_id, supplier_id, price, sale_percent, is_flash_sale]
    );
    const productId = productRes.rows[0].id;

    // === 3. INSERT PRODUCT IMAGES (ảnh đầu = chính) ===
    if (images.length > 0) {
      const values = [];
      const params = [productId]; // $1 = productId
      images.forEach((url, i) => {
        const pos = i + 1; // position bắt đầu từ 1
        params.push(url, pos);
        values.push(`($1, $${params.length - 1}, $${params.length})`); // product_id, url, position
      });
      await client.query(
        `INSERT INTO product_images (product_id, url, "position")
         VALUES ${values.join(',')}`,
        params
      );
    }

    // === 4. VALIDATE ALL SKUs BEFORE INSERT ===
    const skuList = variants.map(v => v.sku).filter(Boolean);
    if (skuList.length !== variants.length) {
      throw new Error('All variants must have SKU');
    }

    const duplicateSkus = skuList.filter((sku, idx) => skuList.indexOf(sku) !== idx);
    if (duplicateSkus.length > 0) {
      throw new Error(`Duplicate SKUs: ${duplicateSkus.join(', ')}`);
    }

    // Kiểm tra SKU đã tồn tại trong DB
    for (const sku of skuList) {
      const exists = await client.query('SELECT 1 FROM product_variants WHERE sku = $1', [sku]);
      if (exists.rowCount > 0) {
        throw new Error(`SKU "${sku}" already exists`);
      }
    }

    // === 5. INSERT VARIANTS + IMAGES ===
    for (const variant of variants) {
      const { sku, color_name, color_code, sizes, stock_qty, images: variantImages = [] } = variant;

      // Insert variant
      const variantRes = await client.query(
        `INSERT INTO product_variants 
         (product_id, sku, color_name, color_code, sizes, stock_qty)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id`,
        [productId, sku, color_name, color_code, JSON.stringify(sizes), stock_qty]
      );
      const variantId = variantRes.rows[0].id;

      // Insert variant images
      if (variantImages.length > 0) {
        const values = [];
        const params = [variantId];
        variantImages.forEach((url, i) => {
          const pos = i + 1;
          params.push(url, pos);
          values.push(`($1, $${params.length - 1}, $${params.length})`); // variant_id, url, position
        });
        await client.query(
          `INSERT INTO product_images (variant_id, url, "position")
           VALUES ${values.join(',')}`,
          params
        );
      }
    }

    await client.query('COMMIT');

    // === 6. LẤY DỮ LIỆU ĐẦY ĐỦ (NESTED JSON) ===
    const result = await client.query(
        `SELECT 
            p.id,
            p.name,
            p.description,
            p.price,
            p.sale_percent,
            p.is_flash_sale,
            s.name as brand,
            CAST(p.final_price AS INTEGER) AS final_price,
            c.name AS category_name,
            s.name AS supplier_name,
            COALESCE(
              (
                SELECT json_agg(json_build_object('url', pi.url) ORDER BY pi.id)
                FROM product_images pi
                WHERE pi.product_id = p.id AND pi.variant_id IS NULL
              ), '[]'::json
            ) AS product_images,
            COALESCE(
              (
                SELECT json_agg(
                  json_build_object(
                    'id', pv.id,
                    'sku', pv.sku,
                    'color_name', pv.color_name,
                    'color_code', pv.color_code,
                    'sizes', pv.sizes,
                    'stock_qty', pv.stock_qty,
                    'images', (
                      SELECT COALESCE(
                        json_agg(json_build_object('url', pi2.url) ORDER BY pi2.id),
                        '[]'::json
                      )
                      FROM product_images pi2
                      WHERE pi2.variant_id = pv.id
                    )
                  ) ORDER BY pv.id
                )
                FROM product_variants pv
                WHERE pv.product_id = p.id
              ), '[]'::json
            ) AS variants
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        WHERE p.id = $1`,
        [productId]
    );

    return result.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.updateFlashSale = async(productId, { sale_percent, is_flash_sale})=> {
  const client = await pool.connect();

  try{
    await client.query('BEGIN');

    // Validate ở BE trước
    if (is_flash_sale === true && (!sale_percent || sale_percent <= 0)) {
      throw new Error('sale_percent must be greater than 0 when is_flash_sale = true');
    }

    const result = await client.query(
      `UPDATE products
      SET sale_percent = $1, is_flash_sale = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
      [sale_percent, is_flash_sale, productId]
    );

    if (result.rowCount === 0) throw new Error ('Product not found');

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');

    // XỬ LÝ LỖI TỪ CHECK CONSTRAINT
    if (error.constraint === 'chk_flash_sale_percent') {
      throw new Error('Cannot enable flash sale with 0% discount');
    }
    throw error;
  } finally {
    client.release();
  }
};

exports.updateProduct = async (productId, data) => {
  const { name, description, price, images = [], variants = [], category_id, supplier_id } = data;

  if (!price || price <= 0) {
    throw new Error('Price must be greater than 0');
  }

  // VALIDATE: Nếu có gửi images → phải có ít nhất 1
  if (images.length === 0) {
    const err = new Error('Product must have at least 1 image');
    err.statusCode = 400;
    throw err;
  }

  // VALIDATE: Mỗi variant phải có ít nhất 1 ảnh
  for (const v of variants) {
    if (!v.images || v.images.length === 0) {
      const err = new Error(`Variant SKU "${v.sku}" must have at least 1 image`);
      err.statusCode = 400;
      throw err;
    }
  }
  const client = await pool.connect();

  try{
    await client.query('BEGIN');

    //đảm bảo sản phẩm tồn tại và lấy để kiểm tra category & supplier hiện tại
    const existingProductRes = await client.query(
      `SELECT id, category_id, supplier_id FROM products WHERE id = $1`,
      [productId]
    );
    if(existingProductRes.rowCount === 0) throw new Error('Product not found');
    const existingProduct = existingProductRes.rows[0];

    //nếu có thay đổi category_id/ supplier_id thì kiểm tra hợp lệ
    let finalCategoryId = existingProduct.category_id;
    let finalSupplierId = existingProduct.supplier_id;

    if(typeof category_id !== 'undefined' && category_id !== null){
      const cat = await client.query('SELECT id FROM categories WHERE id = $1', [category_id]);
      if(cat.rowCount === 0) throw new Error('Invalid category_id');
      finalCategoryId = category_id;
    }

    if(typeof supplier_id !== 'undefined' && supplier_id !== null){
      const sup = await client.query('SELECT id FROM suppliers WHERE id = $1', [supplier_id]);
      if(sup.rowCount === 0) throw new Error('Invalid supplier_id');
      finalSupplierId = supplier_id;
    }

    //1. cập nhật product
    const productRes = await client.query(
      `UPDATE products
      SET name = $1, description = $2, price = $3, category_id = $4, supplier_id = $5, updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [name, description, price, finalCategoryId, finalSupplierId, productId]
    );
    if (productRes.rowCount === 0) throw new Error ('Product not found');

    //2. Xóa ảnh cũ + thêm mới (product images)
    await client.query('DELETE FROM product_images WHERE product_id = $1 AND variant_id IS NULL', [productId]);
    if(images.length > 0){
      let valuesClauses = [];
      let params = [productId];
      images.forEach((url, i) => {
        const position = i + 1;
        params.push(url, position);
        const urlIdx = params.length - 1;
        const posIdx = params.length;
        valuesClauses.push(`($1, $${urlIdx}, $${posIdx})`);
      });
      await client.query(
        `INSERT INTO product_images (product_id, url, "position") VALUES ${valuesClauses.join(',')}`,
        params
      );
    }

    // //3. Xóa variants cũ + ảnh của variants
    // const oldVariants = await client.query('SELECT id FROM product_variants WHERE product_id = $1', [productId]);
    // for (const v of oldVariants.rows){
    //   await client.query('DELETE FROM product_images WHERE variant_id = $1', [v.id]);
    // }
    // // fix: thêm dấu '=' cho WHERE
    // await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);

    // //4. Thêm variants mới
    // for(const variant of variants){
    //   // use the iterator variable `variant` (was `v` before)
    //   const { sku, color_name, color_code, sizes, stock_qty, images: vImages = [] } = variant;
      
    //   //kiểm tra sku 
    //   const checkSku = await client.query('SELECT 1 FROM product_variants WHERE sku = $1', [sku]);
    //   if(checkSku.rowCount > 0){
    //     throw new Error (`SKU "${sku}" already exists`);
    //   }

    //   const variantRes = await client.query(
    //     `INSERT INTO product_variants 
    //      (product_id, sku, color_name, color_code, sizes, stock_qty)
    //      VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    //      RETURNING id`,
    //     [productId, sku, color_name, color_code, JSON.stringify(sizes), stock_qty]
    //   );
    //   const variantId = variantRes.rows[0].id;

    //   if (vImages.length > 0) {
    //   let valuesClause = [];
    //   let params = [variantId]; // $1 = variantId
    //   vImages.forEach((url, index) => {
    //     const position = index + 1;
    //     params.push(url, position);
    //     const urlIdx = params.length - 1;
    //     const posIdx = params.length;
    //     valuesClause.push(`($1, $${urlIdx}, $${posIdx})`);
    //   });
    //   await client.query(
    //     `INSERT INTO product_images (variant_id, url, "position")
    //     VALUES ${valuesClause.join(', ')}`,
    //     params
    //     );
    //   }
    // }

    //3. Xử lý variants cũ + mới
    const existingVariantsRes = await client.query(
      `SELECT id, sku FROM product_variants WHERE product_id = $1`,
      [productId]
    );
    const existingVariantsMap = new Map();
    existingVariantsRes.rows.forEach(v => {
      existingVariantsMap.set(v.id.toString(), v);
    })

    const processedVariantIds = new Set(); // để theo dõi các variant đã xử lý
    for (const variant of variants){
      const { id, sku, color_name, color_code, sizes, stock_qty = 0, images: vImages = [] } = variant;

      if(id && existingVariantsMap.has(id.toString())){
        //case1: variant cũ -> update (giữ nguyên variant_id)
        processedVariantIds.add(id.toString());

        //kiểm tra sku trùng(ngoại trừ chính nó)
        const checkSku = await client.query(
          `SELECT 1 FROM product_variants WHERE sku = $1 AND id != $2`,
          [sku, id]
        );

        if(checkSku.rowCount > 0){
          throw new Error (`SKU "${sku}" already exists in another variant`);
        }

        //update variant info
        await client.query(
          `UPDATE product_variants
           SET sku = $1, color_name = $2, color_code = $3, sizes = $4::jsonb, stock_qty = $5, updated_at = NOW()
           WHERE id = $6`,
          [sku, color_name || null, color_code || null, JSON.stringify(sizes), stock_qty, id]
        );

        //xóa ảnh cũ của variant này
        await client.query('DELETE FROM product_images WHERE variant_id = $1', [id]);

        //thêm ảnh mới
        if(vImages.length > 0){
          const valuesClauses = [];
          const params = [id];
          vImages.forEach((url, i) => {
            const position = i+1;
            params.push(url, position);
            valuesClauses.push(`($1, $${params.length - 1}, $${params.length})`);
          });
          await client.query(
            `INSERT INTO product_images (variant_id, url, "position")
             VALUES ${valuesClauses.join(', ')}`,
            params
          );
        }
      }else{
        //case2: variant mới -> insert
        //kiểm tra sku trùng
        const checkSku = await client.query(
          `SELECT 1 FROM product_variants WHERE sku = $1`,
          [sku]
        );
        if(checkSku.rowCount > 0){
          throw new Error (`SKU "${sku}" already exists`);
        }
        const variantRes = await client.query(
          `INSERT INTO product_variants 
           (product_id, sku, color_name, color_code, sizes, stock_qty)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           RETURNING id`,
          [productId, sku, color_name || null, color_code || null, JSON.stringify(sizes), stock_qty]
        );
        const newVariantId = variantRes.rows[0].id;
        processedVariantIds.add(newVariantId.toString());

        //thêm ảnh mới
        if(vImages.length > 0){
          const valuesClauses = [];
          const params = [newVariantId];
          vImages.forEach((url, i) => {
            const position = i+1;
            params.push(url, position);
            valuesClauses.push(`($1, $${params.length - 1}, $${params.length})`);
          });
          await client.query(
            `INSERT INTO product_images (variant_id, url, "position")
             VALUES ${valuesClauses.join(', ')}`,
            params
          );
        }
      }
    }

    //4. Trả dữ liệu đầy đủ
    const full = await client.query(
      `SELECT * FROM v_product_full WHERE id = $1`, [productId]
    );

    await client.query('COMMIT');
    return full.rows[0];
  }catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

exports.deleteProduct = async (productId) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // kiểm tra tồn tại
    const check = await client.query('SELECT id FROM products WHERE id = $1', [productId]);
    if (check.rowCount === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Product not found');
      err.statusCode = 404;
      throw err;
    }

    // xóa ảnh variants trước
    // await client.query(
    //   `DELETE FROM product_images
    //    WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = $1)`,
    //   [productId]
    // );

    // // xóa variants
    // await client.query('DELETE FROM product_variants WHERE product_id = $1', [productId]);

    // // xóa ảnh product (không có variant_id)
    // await client.query('DELETE FROM product_images WHERE product_id = $1 AND variant_id IS NULL', [productId]);

    // // xóa product
    // const del = await client.query('DELETE FROM products WHERE id = $1 RETURNING id', [productId]);

    //set status sp về inactive thay vì xóa hẳn
    const del = await client.query(
      `UPDATE products 
       SET status = 'inactive', updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [productId]
    );
    await client.query('COMMIT');

    return del.rows[0] || null;
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    console.error('deleteProduct error:', error && error.stack ? error.stack : error);
    throw error;
  } finally {
    if (client) client && client.release();
  }
};

exports.getProductById = async (productId) => {
  const q = `
    SELECT 
      p.id,
      p.name,
      p.description,
      p.price,
      p.sale_percent,
      p.is_flash_sale,
      p.status,
      c.name AS category_name,
      s.name AS supplier_name,
      COALESCE(
        (
          SELECT json_agg(json_build_object('url', pi.url) 
                  ORDER BY COALESCE(pi."position", 999999), pi.id)
          FROM product_images pi
          WHERE pi.product_id = p.id AND pi.variant_id IS NULL
        ), '[]'::json
      ) AS product_images,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'color_name', pv.color_name,
              'color_code', pv.color_code,
              'sizes', pv.sizes,
              'stock_qty', pv.stock_qty,
              'images', (
                SELECT COALESCE(
                  json_agg(json_build_object('url', pi2.url) 
                            ORDER BY COALESCE(pi2."position", 999999), pi2.id),
                  '[]'::json
                )
                FROM product_images pi2
                WHERE pi2.variant_id = pv.id
              )
            ) ORDER BY pv.id
          )
          FROM product_variants pv
          WHERE pv.product_id = p.id
        ), '[]'::json
      ) AS variants
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.id = $1
  `;
  const res = await pool.query(q, [productId]);
  return res.rowCount ? res.rows[0] : null;
};

exports.getAvailableProducts = async () => {
  const result = await pool.query(`
    SELECT 
      p.id,
      p.name,
      p.description,
      p.price::integer,
      p.final_price,
      c.name AS category_name,
      pv.color_name,
      pv.color_code,
      pv.sizes,
      pv.stock_qty,
      COALESCE(pi.urls, '[]'::jsonb) AS images,
      json_build_object(
        'style_tags', COALESCE(ARRAY[
          CASE WHEN p.name ILIKE '%polo%' THEN 'polo' END,
          CASE WHEN p.name ILIKE '%jean%' THEN 'jeans' END,
          CASE WHEN p.name ILIKE '%áo thun%' THEN 'casual' END,
          CASE WHEN p.price > 500000 THEN 'premium' ELSE 'affordable' END
        ] FILTER (WHERE ... không null), '{}')
      ) AS inferred_tags
    FROM products p
    JOIN product_variants pv ON pv.product_id = p.id
    LEFT JOIN (
      SELECT variant_id, json_agg(json_build_object('url', url) ORDER BY COALESCE("position", 999999), id) AS urls
      FROM product_images WHERE variant_id IS NOT NULL
      GROUP BY variant_id
    ) pi ON pi.variant_id = pv.id
    JOIN categories c ON c.id = p.category_id
    WHERE pv.stock_qty > 0 AND p.status = 'active'
  `);

  return result.rows;
};

//hàm update trạng thái product
exports.updateProductStatus = async (productId, status) => {
  const validStatuses = ['active', 'inactive'];
  if(!status || !validStatuses.includes(status.toLowerCase())){
    const err = new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const normalizedStatus = status.toLowerCase();
  const client = await pool.connect();

  try{
    await client.query('BEGIN');

    //check sp tồn tại
    const check = await client.query('SELECT id, status, name FROM products WHERE id =$1', [productId]);
    if(check.rowCount === 0){
      const err = new Error('Product not found');
      err.statusCode = 404;
      throw err;
    }

    const currentProduct = check.rows[0];
    console.debug('[updateProductStatus] updating product', {
      productId,
      currentStatus: currentProduct.status,
      newStatus: normalizedStatus,
      productName: currentProduct.name
    });

    //update trạng thái inactive -> active hoặc ngược lại
    const updateRes = await client.query(
      `UPDATE products 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
      [normalizedStatus, productId]
    );

    if(updateRes.rowCount === 0){
      throw new Error('Failed to update product status');
    }

    //lấy lại dữ liệu đầy đủ
    const fullRes = await client.query(
      `SELECT * FROM v_product_full WHERE id = $1`,
      [productId]
    );

    await client.query('COMMIT');

    console.debug('[updateProductStatus] product status updated successfully', {
      productId,
      newStatus: normalizedStatus
    });

    return fullRes.rows[0] || updateRes.rows[0];
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
