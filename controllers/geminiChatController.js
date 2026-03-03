const chatApiService = require('../services/chatApiServices');

exports.chat = async (req, res, next) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'Empty message' });
  }
  try {
    const authValue = req.user?.id || req.body.ssid || "";
    const isUser = req.user?.id ? true : false;
    const response = await chatApiService.sendMessage(message, authValue, isUser);
    return res.status(200).json(response);
  } catch (err) {
    console.error('Chat API error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Chat API failed' });
  }
};
exports.loadHistory = async (req, res, next) => {

}