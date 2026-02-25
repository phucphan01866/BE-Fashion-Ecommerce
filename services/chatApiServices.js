const pool = require('../config/db');
const { Type, GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({
});

const searchMatchingOutfit = {
    name: 'search_matching_outfit',
    description: 'Tìm các trang phục phù hợp với yêu cầu của người dùng (ưu tiên theo loại trang phục, màu sắc, kích thước).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            type: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Loại trang phục (quần jean, áo sơ mi, v.v.).',
            },
            color: {
                type: Type.STRING,
                description: 'Màu sắc mong muốn (ví dụ: "trắng", "đen", "xanh").',
            },
            size: {
                type: Type.STRING,
                description: 'Kích thước mong muốn (ví dụ: "S", "M", "L").',
            },
        },
        required: ['type', 'color', 'size'],
    },
};

exports.chatApi = async (chatContent, responseID = null) => {
    console.log(chatContent);
    try {
        const response = await ai.models.generateContent({
            apiKey: process.env.GOOGLE_API_KEY,
            model: "gemini-3-flash-preview",
            contents: chatContent,
            tools: [searchMatchingOutfit],
        });
        return {
            text: response.candidates[0]?.content?.parts[0]?.text || '',
        };
    } catch (error) {
        console.error('chatApi error:', error && error.stack ? error.stack : error);
        return { text: 'Xin lỗi, đã có lỗi xảy ra khi xử lý yêu cầu của bạn.' };
    }
}

// response:
// {
//     "sdkHttpResponse": {
//         "headers": {
//             "alt-svc": "h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000",
//             "content-encoding": "gzip",
//             "content-type": "application/json; charset=UTF-8",
//             "date": "Tue, 24 Feb 2026 15:03:35 GMT",
//             "server": "scaffolding on HTTPServer2",
//             "server-timing": "gfet4t7; dur=1653",
//             "transfer-encoding": "chunked",
//             "vary": "Origin, X-Origin, Referer",
//             "x-content-type-options": "nosniff",
//             "x-frame-options": "SAMEORIGIN",
//             "x-xss-protection": "0"
//         }
//     },
//     "candidates": [
//         {
//             "content": {
//                 "parts": [
//                     {
//                         "text": "Hello! How can I help you today?",
//                         "thoughtSignature": "EskBCsYBAb4+9vsn03d7F1IKHmaR9hUpnnysShAgUhoTt353LEsnbTm00wIBrnZSceZlnoYY297H+8ILJW6mly6b+s6PQ5v6LNcz8dwchdKxJ3YTH6ni/ylk1S4VK76r7L8SgN36o5Bd3hQGOP7T8PXRAK1TrRGXUOMlXcuUuU7FcrokZEQfxz3nM8TT3Fy8wffAdF3Wtq5oSHG9ReubUsSdakHIcNpV5IRzMtn2SWwrJ6h2acdfO0GxugqkIqrm0QZ9LF02QIHUV/cj"
//                     }
//                 ],
//                 "role": "model"
//             },
//             "finishReason": "STOP",
//             "index": 0
//         }
//     ],
//     "modelVersion": "gemini-3-flash-preview",
//     "responseId": "x72daaW7LOeivr0P3I7ewAQ",
//     "usageMetadata": {
//         "promptTokenCount": 2,
//         "candidatesTokenCount": 9,
//         "totalTokenCount": 52,
//         "promptTokensDetails": [
//             {
//                 "modality": "TEXT",
//                 "tokenCount": 2
//             }
//         ],
//         "thoughtsTokenCount": 41
//     }
// }

// exports.createOrder = async (userId, orderData) => {
//   const client = await pool.connect();
//   try {
//     await client.query('BEGIN');

//     // validate and normalize incoming items
//     const rawItems = Array.isArray(orderData?.items) ? orderData.items : [];
//     if (rawItems.length === 0) {
//       const e = new Error('items is required');
//       e.status = 400;
//       throw e;
//     }

//     // merge duplicates by variant_id + size
//     const mergedMap = new Map();
//     for (const it of rawItems) {
//       if (!it || !it.variant_id) {
//         const err = new Error('variant_id is required for each item');
//         err.status = 400;
//         throw err;
//       }
//       const qtyRaw = it.quantity ?? it.qty ?? 1;
//       const qty = Math.max(0, parseInt(qtyRaw, 10) || 0);
//       if (qty <= 0) {
//         const err = new Error('quantity must be > 0');
//         err.status = 400;
//         throw err;
//       }
//       const sizeVal = it.size ?? it.size_snapshot ?? null;
//       const key = `${it.variant_id}::${sizeVal ?? ''}`;
//       if (!mergedMap.has(key)) {
//         mergedMap.set(key, { variant_id: it.variant_id, quantity: qty, size: sizeVal, meta: it.meta || null });
//       } else {
//         const cur = mergedMap.get(key);
//         cur.quantity += qty;
//       }
//     }
//     const items = Array.from(mergedMap.values());

//     // fetch variant + product info for all variants in one query (FOR UPDATE to lock stock)
//     const variantIds = items.map(i => i.variant_id);
//     const { rows: variantRows } = await client.query(
//       `SELECT pv.id AS variant_id, pv.product_id, pv.stock_qty, pv.sold_qty,
//               p.name AS product_name, COALESCE(p.final_price, p.price)::numeric AS unit_price
//        FROM product_variants pv
//        JOIN products p ON p.id = pv.product_id
//        WHERE pv.id = ANY($1::uuid[]) FOR UPDATE`,
//       [variantIds]
//     );

//     const variantMap = new Map();
//     for (const v of variantRows) variantMap.set(String(v.variant_id), v);

//     // validate stock & compute totals
//     let subtotal = 0;
//     const orderItemsData = [];
//     for (const it of items) {
//       const v = variantMap.get(String(it.variant_id));
//       if (!v) {
//         throw Object.assign(new Error(`Variant not found: ${it.variant_id}`), { status: 400 });
//       }
//       if (v.stock_qty < it.quantity) {
//         throw Object.assign(new Error(`Insufficient stock for variant ${it.variant_id}`), { status: 400 });
//       }
//       const unitPrice = Number(v.unit_price) || 0;
//       const lineTotal = round2(unitPrice * it.quantity);
//       subtotal += lineTotal;
//       orderItemsData.push({
//         variant_id: it.variant_id,
//         product_id: v.product_id,
//         qty: it.quantity,
//         unit_price: unitPrice,
//         name_snapshot: v.product_name,
//         color_snapshot: null,
//         size_snapshot: it.size || null,
//         final_price: lineTotal, // will be reduced if promo applies
//         promo_applied: false,
//         promo_discount: 0
//       });
//     }

//     // promotion handling (preview + allocation)
//     let discount = 0;
//     let appliedPromotion = null;
//     const shipping_fee = Number(orderData.shipping_fee ?? 30000);

//     if (orderData.promotion_code) {
//       // prepare items shape expected by preview function
//       const itemsForPromo = orderItemsData.map((oi) => ({
//         variant_id: oi.variant_id,
//         product_id: oi.product_id,
//         qty: oi.qty,
//         unit_price: oi.unit_price,
//         line_base: round2(Number(oi.final_price)),
//         size: oi.size_snapshot || null
//       }));

//       const preview = await promotionService.getPreviewPromotionApplication({
//         userId,
//         items: itemsForPromo,
//         shipping_fee,
//         promotion_code: String(orderData.promotion_code).trim()
//       });

//       if (!preview || preview.valid !== true) {
//         const e = new Error(preview?.reason || 'Promotion not applicable or invalid');
//         e.status = 400;
//         throw e;
//       }

//       // map breakdown discounts to variant_id::size keys
//       const discMap = new Map();
//       for (const b of preview.discount_breakdown || []) {
//         const key = `${b.variant_id}::${b.size ?? ''}`;
//         discMap.set(key, Number(b.discount || 0));
//       }

//       // apply per-item discount and mark promo_applied
//       let allocatedTotal = 0;
//       for (const oi of orderItemsData) {
//         const key = `${oi.variant_id}::${oi.size_snapshot ?? ''}`;
//         const d = round2(discMap.get(key) || 0);
//         if (d > 0) {
//           oi.final_price = round2(Math.max(0, Number(oi.final_price) - d));
//           oi.promo_applied = true;
//           oi.promo_discount = d;
//           allocatedTotal += d;
//         }
//       }

//       discount = round2(Number(preview.discount || allocatedTotal || 0));
//       appliedPromotion = preview.promotion ? { id: preview.promotion.id, code: preview.promotion.code } : { code: String(orderData.promotion_code).trim() };

//       // protective: if preview reported discount but allocation sum mismatch, prefer preview.discount
//       if (Math.abs(discount - allocatedTotal) > 0.01) {
//         // adjust last eligible item to match preview.discount
//         const lastIdx = orderItemsData.length - 1;
//         const diff = round2(discount - allocatedTotal);
//         if (diff !== 0) {
//           orderItemsData[lastIdx].final_price = round2(orderItemsData[lastIdx].final_price - diff);
//           orderItemsData[lastIdx].promo_discount = round2((orderItemsData[lastIdx].promo_discount || 0) + diff);
//         }
//       }
//     }

//     // compute final amount
//     let final_amount = round2(subtotal - discount + Number(shipping_fee || 0));
//     if (final_amount < 0) final_amount = 0;

//     // insert order (use shipping_address_snapshot field)
//     const orderInsert = await client.query(
//       `INSERT INTO orders (user_id, total_amount, discount_amount, shipping_fee, final_amount, payment_status, order_status, shipping_address_snapshot, payment_method, created_at, updated_at)
//        VALUES ($1, $2, $3, $4, $5, 'unpaid', 'pending', $6, $7, NOW(), NOW())
//        RETURNING id, created_at`,
//       [
//         userId,
//         round2(subtotal),
//         round2(discount),
//         Number(shipping_fee),
//         final_amount,
//         orderData.shipping_address_snapshot ? JSON.stringify(orderData.shipping_address_snapshot) : null,
//         orderData.payment_method || null
//       ]
//     );
//     const orderId = orderInsert.rows[0].id;

//     // insert order_items and update stock
//     for (const oi of orderItemsData) {
//       await client.query(
//         `INSERT INTO order_items (order_id, variant_id, qty, unit_price, name_snapshot, color_snapshot, size_snapshot, final_price, promo_applied)
//          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
//         [orderId, oi.variant_id, oi.qty, oi.unit_price, oi.name_snapshot, oi.color_snapshot, oi.size_snapshot, oi.final_price, oi.promo_applied]
//       );

//       // update stock_qty and sold_qty
//       await client.query(
//         `UPDATE product_variants
//          SET stock_qty = GREATEST(stock_qty - $1, 0),
//              sold_qty = COALESCE(sold_qty, 0) + $1,
//              updated_at = NOW()
//          WHERE id = $2`,
//         [oi.qty, oi.variant_id]
//       );
//     }

//     // If promotion applied, increment used_count and insert user_promotion 'used' record (in same transaction)
//     if (appliedPromotion && appliedPromotion.id) {
//       // lock promotion row and update used_count (prevent race)
//       const pQ = await client.query(`SELECT id, used_count, usage_limit FROM promotions WHERE id = $1 FOR UPDATE`, [appliedPromotion.id]);
//       if (pQ.rowCount) {
//         const promoRow = pQ.rows[0];
//         if (promoRow.usage_limit != null && (Number(promoRow.used_count || 0) + 1) > Number(promoRow.usage_limit)) {
//           throw Object.assign(new Error('Promotion usage limit exceeded'), { status: 400 });
//         }
//         await client.query(`UPDATE promotions SET used_count = COALESCE(used_count,0) + 1 WHERE id = $1`, [appliedPromotion.id]);

//         // record user usage (audit)
//         try {
//           if (promotionId) {
//             try {
//               await client.query(
//                 `INSERT INTO user_promotions (id, user_id, promotion_id, action, created_at, code)
//                 VALUES (gen_random_uuid(), $1, $2, $3, NOW(), $4)
//                 ON CONFLICT (user_id, promotion_id, action) DO NOTHING`,
//                 [userId, promotionId, 'apply', promoCode]
//               );
//             } catch (e) {
//               // log chi tiết nhưng không làm abort toàn bộ transaction
//               console.warn('[createOrder] user_promotions insert non-fatal error, continuing', e && e.stack ? e.stack : e);
//               // nếu muốn rollback chỉ phần này, có thể dùng SAVEPOINT/ROLLBACK TO SAVEPOINT
//             }
//           }
//         } catch (e) {
//           // best-effort: don't fail entire order if user_promotion insert conflicts
//           console.error('[createOrder] user_promotions insert failed', e && e.stack ? e.stack : e);
//         }
//       }
//     }

//     // clear user's cart (best-effort)
//     try {
//       const cRes = await client.query('SELECT id FROM carts WHERE user_id = $1 LIMIT 1', [userId]);
//       if (cRes.rows.length) {
//         const cartId = cRes.rows[0].id;
//         await client.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
//         await client.query('DELETE FROM carts WHERE id = $1', [cartId]);
//       }
//     } catch (e) {
//       console.error('[createOrder] clear cart failed', e && e.stack ? e.stack : e);
//     }

//     await client.query('COMMIT');

//     // return basic order summary (include per-item promo_discount for client)
//     return {
//       id: orderId,
//       total_amount: round2(subtotal),
//       discount_amount: round2(discount),
//       shipping_fee: Number(shipping_fee),
//       final_amount,
//       items: orderItemsData.map(it => ({
//         variant_id: it.variant_id,
//         qty: it.qty,
//         size: it.size_snapshot,
//         unit_price: it.unit_price,
//         final_price: it.final_price,
//         promo_applied: it.promo_applied,
//         promo_discount: round2(it.promo_discount || 0)
//       }))
//     };
//   } catch (err) {
//     await client.query('ROLLBACK').catch(() => {});
//     console.error('[createOrder] error', err && err.stack ? err.stack : err);
//     throw err;
//   } finally {
//     client.release();
//   }
// };