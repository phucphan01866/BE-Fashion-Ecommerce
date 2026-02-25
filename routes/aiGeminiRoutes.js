const express = require('express');
const router = express.Router();
const chatApiController = require('../controllers/orders/chatApiController');

router.post('/chat', chatApiController.sendMsg);

module.exports = router;