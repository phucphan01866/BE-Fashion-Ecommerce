const { chatApi } = require("../../services/chatApiServices");


exports.sendMsg = async (req, res) => {
    const { message } = req.body;
    if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message is required' });
    }
    const reply = await chatApi(message);
    res.status(200).json(reply);
    // console.log('Received message:', message);
}