const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' })); // Cho front-end gọi

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS; // 7400f090-...
const IPN_SECRET = 'uKC6vWHrVb2Qtc8yt8j0sH1OQgMSH05x'; // Hardcode tạm, sẽ sửa
const TATUM_API_KEY = process.env.TATUM_API_KEY;
const BSC_PRIVATE_KEY = process.env.YOUR_BSC_WALLET_PRIVATE_KEY;
const USDT_WALLET = process.env.USDT_WALLET;

// Temp storage (in-memory)
const tempStorage = {};

// Preview data sẽ ghi lên blockchain
app.post('/api/preview-data', (req, res) => {
  const { encryptedPayload } = req.body;
  const hexData = Buffer.from(encryptedPayload).toString('hex');
  res.json({ previewData: hexData });
});

// Tạo payment NowPayments
app.post('/api/create-payment', async (req, res) => {
  const { amount, noteId, encryptedPayload } = req.body;
  try {
    const response = await axios.post('https://api.nowpayments.io/v1/payment', {
      price_amount: amount,
      price_currency: 'usdtbep20',
      pay_currency: 'usdtbep20',
      order_id: noteId,
      order_description: `Timelock Note ${noteId}`,
      ipn_callback_url: `${process.env.RAILWAY_PUBLIC_DOMAIN}/webhook/nowpayments`,
      payout_address: USDT_WALLET,
    }, { headers: { 'x-api-key': NOWPAYMENTS_API_KEY } });
    tempStorage[noteId] = { encryptedPayload }; // Lưu tạm
    res.json({
      qrCode: response.data.qr_code,
      paymentAddress: response.data.payment_address,
      paymentId: response.data.payment_id
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data?.message || 'Lỗi tạo thanh toán' });
  }
});

// Webhook NowPayments
app.post('/webhook/nowpayments', async (req, res) => {
  const sig = req.headers['x-nowpayments-sig'];
  const hmac = crypto.createHmac('sha512', IPN_SECRET);
  const calcSig = hmac.update(JSON.stringify(req.body, Object.keys(req.body).sort())).digest('hex');
  if (sig !== calcSig) return res.status(401).send('Invalid signature');

  if (req.body.payment_status === 'finished') {
    const { order_id } = req.body;
    const encryptedPayload = tempStorage[order_id]?.encryptedPayload;
    if (!encryptedPayload) return res.status(404).send('No data');

    try {
      const tatumRes = await axios.post('https://api.tatum.io/v3/record', {
        chain: 'BSC',
        data: Buffer.from(encryptedPayload).toString('hex'),
        fromPrivateKey: BSC_PRIVATE_KEY,
        to: '0x0000000000000000000000000000000000000000',
      }, { headers: { 'x-api-key': TATUM_API_KEY } });
      tempStorage[order_id].txHash = tatumRes.data.txId;
    } catch (error) {
      console.error('Tatum error:', error);
    }
  }
  res.status(200).send('OK');
});

// Lấy txHash cho client
app.get('/api/get-tx/:noteId', (req, res) => {
  const txHash = tempStorage[req.params.noteId]?.txHash;
  if (txHash) res.json({ txHash });
  else res.status(404).json({ error: 'Chưa xác nhận' });
});

app.listen(process.env.PORT || 3000, () => console.log('Back-end running'));
