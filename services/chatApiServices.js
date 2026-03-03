const pool = require('../config/db');
const { Type, GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({
});

// searchMatchingOutfitHandler result: [
//   {
//     id: '071619a6-4a25-4ca8-9d0e-ed50a7c56c57',
//     name: 'Quần Jean Suông Trắng Nam Ống Rộng',
//     description: 'Quần Jean Trắng SUÔNG Ống Rộng 31-34CM Nam Dáng Đứng Lưng Cao\n' +
//       '- Chất Liệu: Jean Denim\n' +
//       '- Màu sắc: VER3. Jean Trắng Ống 33CM\n' +
//       '- Kiểu dáng: Quần Jean Nam SUông Ống Rộng 33CM Trắng Trơn Lưng Cao Tôn Dáng\n' +
//       'Phù hợp cho dịp đi chơi, đi học, và các dịp khác. Chất vải mềm, tôn dáng, tạo cảm giác dễ chịu cho người mặc khi mặc trong thời gian dài.',
//     category_id: 'bfad29e9-032c-4498-b70c-eaac37162870',   
//     supplier_id: '5d0ee03a-eab9-423c-942a-ca9e0322800c',   
//     status: 'active',
//     created_at: 2025-12-14T10:15:33.154Z,
//     updated_at: 2025-12-15T13:52:22.818Z,
//     price: '180000.00',
//     sale_percent: '0.00',
//     is_flash_sale: false,
//     final_price: 180000,
//     sequence_id: '111'
//   },
//   {
//     id: 'b498eac7-3002-41e0-bbe6-f0c7763bee25',
//     name: 'Quần Jeans Nam Denim Slim Fit',
//     description: 'Quần Jeans Nam Copper Denim Slim Fit Bền Bỉ, Co Giãn Thoải Mái\n' +
//       'Nâng tầm phong cách hàng ngày với Quần Jeans Nam Copper Denim, một thiết kế hội tụ đủ các yếu tố từ cổ điển đến hiện đại. Sản phẩm được dệt từ chất liệu vải denim cao cấp với định lượng 12 Oz dày dặn, đứng phom, có thành phần gồm 99% vải cotton và 1% vải Spandex.',
//     category_id: 'bfad29e9-032c-4498-b70c-eaac37162870',   
//     supplier_id: 'ee9a160e-1810-4411-bb4e-ab931cb09079',   
//     status: 'active',
//     created_at: 2025-11-22T17:38:56.081Z,
//     updated_at: 2025-12-07T14:10:45.700Z,
//     price: '499000.00',
//     sale_percent: '35.00',
//     is_flash_sale: true,
//     final_price: 324350,
//     sequence_id: '97'
//   }
// ]


const searchMatchingOutfit = {
    name: 'search_matching_outfit',
    description: 'Tìm các trang phục phù hợp với yêu cầu của người dùng (ưu tiên theo loại trang phục, màu sắc, kích thước).',
    parameters: {
        type: Type.OBJECT,
        properties: {
            categories: {
                type: Type.ARRAY,
                description: 'Danh sách các danh mục trang phục cụ thể (ví dụ: "áo sơ mi", "áo thun", "quần jean", "váy")',
                items: {
                    type: Type.STRING,
                },
            },
            color: {
                type: Type.STRING,
                description: 'Màu sắc mong muốn (ví dụ: "trắng", "đen", "xanh", "đỏ"). Để trống nếu không có yêu cầu.',
            },
            size: {
                type: Type.STRING,
                description: 'Kích thước mong muốn (ví dụ: "S", "M", "L", "XL"). Để trống nếu không có yêu cầu.',
            },
        },
        required: ['categories'],
    },
};

async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const res = await callback(client);
        await client.query('COMMIT');
        return res;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        await client.release();
    }
}

const mock_ai_response = { categories: ["áo sơ mi", "áo thun"] };

const searchMatchingOutfitHandler = async (args) => {
    const { categories } = args;
    console.log('searchMatchingOutfitHandler args:', categories);
    try {
        //         SELECT *
        // FROM products p
        // INNER JOIN categories c ON p.category_id = c.id
        // WHERE c.name = ANY($1)
        // ORDER BY p.created_at DESC
        // LIMIT $2
        // const res = await pool.query(`
        //     SELECT *
        //     FROM products
        //     WHERE category_id = $1
        //     ORDER BY created_at DESC
        //     LIMIT $2
        // `, ["bfad29e9-032c-4498-b70c-eaac37162870", 2]);
        const res = await pool.query(`
            SELECT DISTINCT ON (c.parent_id) * 
            FROM products p
            INNER JOIN categories c ON p.category_id = c.id
            WHERE c.name ILIKE ANY($1)
            LIMIT $2`, [categories, 2]);
        console.log('searchMatchingOutfitHandler result:', res.rows);
        return res.rows;
    } catch (err) {
        console.error('searchMatchingOutfitHandler error:', err && err.stack ? err.stack : err);
        return [];
    }
}

// Tôi cần áo màu vàng, size M, loại áo sơ mi
// {
//   "res": [
//     {
//       "name": "search_matching_outfit",
//       "args": {
//         "categories": [
//           "áo sơ mi",
//           "áo thun"
//         ]
//       }
//     }
//   ],
//   "text": ""
// }
exports.sendMessage = async (message, authValue, isUser) => {
    const query =
        `INSERT INTO gemini_chat_logs (user_id, role, content, guest_session_id) VALUES ($1, 'user', $2, $3)`;
    try {
        const res = await withTransaction(
            async (client) => {
                let authValueLocal = authValue;
                // Nếu chưa có session cho guest, tạo mới và lấy session id để lưu vào log
                if (!isUser && authValue === "") {
                    const sessionQuery = 'INSERT INTO gemini_guest_sessions(id) VALUES (gen_random_uuid()) RETURNING id';
                    const sessionResult = await client.query(sessionQuery);
                    authValueLocal = sessionResult.rows[0].id;
                }
                const values = [
                    isUser ? authValueLocal : null,
                    message,
                    isUser ? null : authValueLocal
                ];
                await client.query(query, values);

                const catlist = await client.query('SELECT name FROM categories');
                const categories = catlist.rows.map(r => r.name);

                const response = await ai.models.generateContent({
                    apiKey: process.env.GOOGLE_API_KEY,
                    model: "gemini-3-flash-preview",
                    contents: "Đây là metadata cơ bản của hệ thống: " + JSON.stringify(categories) + "\nHãy trả lời promt sau bằng tiếng Việt: \n" + message,
                    config: {
                        tools: [{
                            functionDeclarations: [searchMatchingOutfit]
                        }],
                    },
                });
                if (response.functionCalls && response.functionCalls.length > 0) {
                    for (const func of response.functionCalls) {
                        switch (func.name) {
                            case 'search_matching_outfit':
                                const res = await searchMatchingOutfitHandler(func.args);
                                return res;
                        }
                    }
                }
                const res = await searchMatchingOutfitHandler(response.functionCalls[0].args);
                // const res = await searchMatchingOutfitHandler(mock_ai_response);
                return res;
                return {
                    // response: response.functionCalls,
                    text: response.candidates[0]?.content?.parts[0]?.text || '',
                };
            }
        )
        return {
            res: res.response,
            text: res.text,
        };
    } catch (error) {
        console.error('chatApi error:', error && error.stack ? error.stack : error);
        return { text: 'Xin lỗi, đã có lỗi xảy ra khi xử lý yêu cầu của bạn.' };
    }
}