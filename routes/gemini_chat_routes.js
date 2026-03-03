const express = require('express');
const router = express.Router();

const geminiChatController = require('../controllers/geminiChatController');

router.post('/chat', geminiChatController.chat);
router.get('/load-history', geminiChatController.loadHistory);

module.exports = router;